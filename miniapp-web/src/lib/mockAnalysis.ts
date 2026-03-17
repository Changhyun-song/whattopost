/**
 * Hierarchical analysis pipeline.
 *
 * Stage 0  → Load models
 * Stage 1  → Per-image feature extraction (1-pass, immediate bitmap close)
 * Stage 2  → Coarse scene grouping (timestamp + scene embedding)
 * Stage 3  → Fine group splitting (face count → framing → identity → pose)
 * Stage 4  → Multi-axis scoring + ranking + hard filter + trim
 * Stage 5  → Explainability: build explanations + failure report
 *
 * The public types (AnalysisResult, PhotoGroup, RankedPhoto, Candidate,
 * ProgressUpdate) remain unchanged for UI compatibility.
 * New explainability fields are additive (optional).
 */

import type { FileEntry } from './fileStore';
import { getFile } from './fileStore';
import { startTimer, log } from './perf';
import { measureAllInOnePass, measureFaceRegionBlur, measureBgSimplicity } from './canvasAnalyzer';
import { loadModels, analyzeAllFaces, type FaceResult } from './faceAnalyzer';
import { computeSceneEmbedding } from './pHash';
import { extractMetadata, extractTimestamp } from './metadata';
import {
  classifyPhotoType,
  detectFraming,
  hasAnyFaceCut,
  type PhotoFeatures,
  type FramingType,
} from './photoTypes';
import { groupByScene } from './sceneGrouper';
import { splitSceneIntoGroups, type GroupDef } from './groupSplitter';
import { rankGroup, trimGroup, type RankedResult } from './bestShotRanker';
import { ruleTracker } from './analysisConfig';

import type {
  ProcessingMetrics,
  StageTiming,
  FailureAnalysisReport,
  RecommendationExplanation,
  GroupingDecisionEvidence,
  LowConfidenceItem,
} from './explainability';
import {
  detectSuspiciousCases,
  buildScoreDistribution,
  buildGroupSizeDistribution,
  explainWhyBest,
  explainWhyRejected,
  computeConfidence,
  deriveFailureReasons,
  deriveThresholdCandidates,
} from './explainability';

// ─── Public types (unchanged for UI compat) ──────────────

export interface QualityScores {
  sharpness: number;
  exposure: number;
  facePresence: number;
  eyeOpen: number;
  faceVisibility: number;
  composition: number;
  expression: number;
  faceCount: number;
}

export interface RankedPhoto {
  fileId: string;
  score: number;
  qualityScores: QualityScores;
  rejected: boolean;
  rejectReason: string | null;
  tags: string[];
  reason: string;
}

export interface PhotoGroup {
  id: string;
  label: string;
  fileIds: string[];
  ranked: RankedPhoto[];
  bestFileId: string | null;
  keptCount: number;
  rejectedCount: number;
}

export interface Candidate {
  fileId: string;
  score: number;
  qualityScores: QualityScores;
  category: 'best' | 'profile' | 'post';
  tag: string;
  reason: string;
}

export interface FaceBoxData {
  faceCount: number;
  rawFaceCount: number;
  worstEAR: number;
  faces: { box: { x: number; y: number; w: number; h: number }; confidence: number; size: number; ear: number; minEyeEAR: number; normEAR: number; eyeContrast: number; eyeBlinkScore: number; expression: string }[];
}

export interface AnalysisResult {
  uploadId: string;
  totalCount: number;
  groupCount: number;
  filteredCount: number;
  rejectedCount: number;
  rejectSummary: Record<string, number>;
  candidateCount: number;
  groups: PhotoGroup[];
  filteredIds: string[];
  candidates: Candidate[];
  allRanked: RankedPhoto[];

  // Face detection debug data (per photo)
  faceDebug?: Record<string, FaceBoxData>;

  // Explainability (additive — existing UI doesn't need these)
  metrics?: ProcessingMetrics;
  failureReport?: FailureAnalysisReport;
  explanations?: RecommendationExplanation[];
  groupEvidence?: GroupingDecisionEvidence[];
}

export interface ProgressUpdate {
  stage: number;
  stageLabel: string;
  stageDetail: string;
  overallProgress: number;
  processedCount: number;
  groupCount: number;
}

// ─── Helpers ─────────────────────────────────────────────

// ─── Aesthetic score helpers ─────────────────────────────

function computeFlattering(face: FaceResult, framing: FramingType): number {
  if (face.faceCount === 0) return 0.5;

  const faceY = face.avgFacePosition.y;
  const faceRatio = face.bestFaceRatio;

  // Face in upper portion = body fills frame = looks taller
  let posScore: number;
  if (faceY < 0.20) posScore = 0.7;
  else if (faceY < 0.35) posScore = 1.0;
  else if (faceY < 0.50) posScore = 0.8;
  else posScore = 0.5;

  // Ideal face-to-frame ratio per framing type
  let ratioScore: number;
  switch (framing) {
    case 'closeup':
      ratioScore = faceRatio > 0.10 && faceRatio < 0.35 ? 1.0 : 0.6;
      break;
    case 'half_body':
      ratioScore = faceRatio > 0.03 && faceRatio < 0.15 ? 1.0 : 0.6;
      break;
    case 'full_body':
    case 'wide':
      ratioScore = faceRatio > 0.005 && faceRatio < 0.08 ? 1.0 : 0.6;
      break;
    default:
      ratioScore = 0.5;
  }

  return posScore * 0.6 + ratioScore * 0.4;
}

function computePoseNatural(face: FaceResult): number {
  if (face.faceCount === 0) return 0.5;

  // Average head pose across all faces
  let rollSum = 0, yawSum = 0;
  for (const f of face.faces) {
    rollSum += Math.abs(f.headRoll);
    yawSum += Math.abs(f.headYaw);
  }
  const avgRoll = rollSum / face.faceCount;
  const avgYaw = yawSum / face.faceCount;

  // Roll: 3-12 degrees = natural slight tilt, >25 = unnatural
  let rollScore: number;
  if (avgRoll < 3) rollScore = 0.7;
  else if (avgRoll < 12) rollScore = 1.0;
  else if (avgRoll < 25) rollScore = 0.6;
  else rollScore = 0.3;

  // Yaw: 5-20 degrees = slight turn (flattering 3/4 view), >35 = profile
  let yawScore: number;
  if (avgYaw < 5) yawScore = 0.7;
  else if (avgYaw < 20) yawScore = 1.0;
  else if (avgYaw < 35) yawScore = 0.5;
  else yawScore = 0.3;

  return rollScore * 0.5 + yawScore * 0.5;
}

function computeSmileQuality(face: FaceResult): number {
  if (face.faceCount === 0) return 0.5;

  let totalScore = 0;
  for (const f of face.faces) {
    // Mouth width relative to face: wider = more smile
    const mouthWidthScore = Math.min(1, Math.max(0, (f.mouthWidthRatio - 0.25) / 0.25));

    // Mouth openness: slight open (0.15-0.40) = natural laugh, too much = unflattering
    let openScore: number;
    if (f.mouthOpenRatio < 0.10) openScore = 0.6;
    else if (f.mouthOpenRatio < 0.40) openScore = 1.0;
    else openScore = 0.5;

    // Eye crinkle (Duchenne smile): EAR slightly reduced (0.6-0.85 normalized) while smiling
    const ear = Math.min(1, Math.max(0, (f.ear - 0.15) / 0.20));
    const isSmiling = f.expression.happy > 0.4;
    let crinkleScore = 0.5;
    if (isSmiling && ear > 0.4 && ear < 0.85) crinkleScore = 1.0;
    else if (isSmiling && ear >= 0.85) crinkleScore = 0.7;

    // Expression model confidence
    const exprScore = Math.min(1, f.expression.happy * 1.5 + f.expression.neutral * 0.8);

    totalScore += mouthWidthScore * 0.20 + openScore * 0.15 + crinkleScore * 0.25 + exprScore * 0.40;
  }

  return totalScore / face.faceCount;
}

function computeThirdsScore(face: FaceResult): number {
  if (face.faceCount === 0) return 0.5;

  const fx = face.avgFacePosition.x;
  const fy = face.avgFacePosition.y;

  // 4 power points (rule of thirds intersections)
  const powerPoints = [
    { x: 1 / 3, y: 1 / 3 },
    { x: 2 / 3, y: 1 / 3 },
    { x: 1 / 3, y: 2 / 3 },
    { x: 2 / 3, y: 2 / 3 },
  ];

  let minDist = Infinity;
  for (const pp of powerPoints) {
    const d = Math.sqrt((fx - pp.x) ** 2 + (fy - pp.y) ** 2);
    if (d < minDist) minDist = d;
  }

  // Max possible distance from any power point is ~0.47 (corner to opposite power point)
  // Score: distance 0 = perfect (1.0), distance 0.3+ = poor (0.3)
  return Math.max(0.2, Math.min(1, 1.0 - minDist * 2.5));
}

function featuresToQualityScores(f: PhotoFeatures): QualityScores {
  const hasFace = f.face.faceCount > 0;
  const earNorm = hasFace ? f.face.worstEAR : 0.7;
  const facePresence = hasFace ? Math.min(1, 0.5 + f.face.bestFaceRatio * 5) : 0;

  let faceVisibility = 0;
  if (hasFace) {
    const smallest = Math.min(...f.face.faces.map((ff) => ff.size));
    faceVisibility = Math.min(1, smallest * 5);
  }

  return {
    sharpness: f.blur,
    exposure: f.exposure,
    facePresence,
    eyeOpen: earNorm,
    faceVisibility,
    composition: f.composition,
    expression: hasFace ? f.face.worstExpression : 0.5,
    faceCount: f.face.faceCount,
  };
}

function rankedResultToRankedPhoto(r: RankedResult, f: PhotoFeatures): RankedPhoto {
  return {
    fileId: r.fileId,
    score: r.breakdown.total,
    qualityScores: featuresToQualityScores(f),
    rejected: r.rejected,
    rejectReason: r.rejectReason,
    tags: r.tags,
    reason: r.reason,
  };
}

function assignCategory(rank: number): Pick<Candidate, 'category' | 'tag'> {
  if (rank === 0) return { category: 'best', tag: '👑 BEST' };
  if (rank <= 2) return { category: 'profile', tag: '프사 추천' };
  return { category: 'post', tag: '올리기 좋은' };
}

// ─── Explanation builder ─────────────────────────────────

function buildExplanations(
  groups: PhotoGroup[],
  allGroupDefs: GroupDef[],
  rankedMap: Map<string, RankedResult>,
  featureMap: Map<string, PhotoFeatures>,
): RecommendationExplanation[] {
  const explanations: RecommendationExplanation[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const gdef = allGroupDefs[gi];
    if (!gdef) continue;

    for (let ri = 0; ri < group.ranked.length; ri++) {
      const rp = group.ranked[ri];
      const rr = rankedMap.get(rp.fileId);
      const f = featureMap.get(rp.fileId);
      if (!rr || !f) continue;

      const isRep = rp.fileId === group.bestFileId;

      // Compared to next photos in group (for representative)
      const comparedTo: RecommendationExplanation['comparedTo'] = [];
      if (isRep) {
        const others = group.ranked.filter((p) => !p.rejected && p.fileId !== rp.fileId);
        for (const other of others.slice(0, 3)) {
          const otherFeatures = featureMap.get(other.fileId);
          const diff = rp.score - other.score;
          let advantage = '종합 점수';
          if (otherFeatures) {
            if (f.blur - otherFeatures.blur > 0.1) advantage = '선명도';
            else if (f.face.worstExpression - otherFeatures.face.worstExpression > 0.1) advantage = '표정';
            else if (f.composition - otherFeatures.composition > 0.1) advantage = '구도';
          }
          comparedTo.push({ fileId: other.fileId, scoreDiff: diff, mainAdvantage: advantage });
        }
      }

      // Why selected / rejected
      let whySelected: string[];
      if (isRep) {
        whySelected = explainWhyBest(rr.detailedBreakdown, f.photoType);
      } else if (rr.rejected) {
        whySelected = explainWhyRejected(rr.rejectReasons);
      } else {
        whySelected = ['대표컷은 아니지만 양호한 사진이에요'];
      }

      // Confidence & low-confidence
      const scoreGap = ri < group.ranked.length - 1 ? rp.score - group.ranked[ri + 1].score : 0.1;
      const confidence = computeConfidence(
        rp.score,
        group.fileIds.length,
        scoreGap,
        f.face.faceCount > 0,
        rp.rejected,
      );
      const lowConfidence = confidence < 0.4;
      let lowConfidenceReason: string | null = null;
      if (lowConfidence) {
        if (scoreGap < 0.05) lowConfidenceReason = '다음 순위와 점수 차이가 매우 작아요';
        else if (group.fileIds.length === 1) lowConfidenceReason = '그룹에 사진이 1장뿐이에요';
        else lowConfidenceReason = '판단 근거가 부족해요';
      }

      explanations.push({
        fileId: rp.fileId,
        groupId: group.id,
        rank: ri,
        isRepresentative: isRep,
        scoreBreakdown: rr.detailedBreakdown,
        rejectReasons: rr.rejectReasons,
        whySelected,
        comparedTo,
        confidence,
        lowConfidence,
        lowConfidenceReason,
      });
    }
  }

  return explanations;
}

// ─── Pipeline ────────────────────────────────────────────

export async function runAnalysis(
  manifest: FileEntry[],
  onProgress: (u: ProgressUpdate) => void,
): Promise<AnalysisResult> {
  const timer = startTimer('analysis pipeline v3');
  ruleTracker.reset();
  const total = manifest.length;
  const uploadId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const uploadSizeBytes = manifest.reduce((sum, e) => sum + e.size, 0);
  const stageTimings: StageTiming[] = [];
  let stageStart = performance.now();

  function emit(stage: number, label: string, detail: string, pct: number, extra: Partial<ProgressUpdate> = {}) {
    onProgress({
      stage,
      stageLabel: label,
      stageDetail: detail,
      overallProgress: Math.min(100, Math.round(pct)),
      processedCount: extra.processedCount ?? 0,
      groupCount: extra.groupCount ?? 0,
    });
  }

  function markStage(name: string) {
    const now = performance.now();
    stageTimings.push({ name, durationMs: Math.round(now - stageStart) });
    stageStart = now;
  }

  // ══════════════════════════════════════════════════════════
  //  Stage 0: Load models
  // ══════════════════════════════════════════════════════════

  log('stage 0 — init');
  emit(0, '준비하고 있어요', 'AI 모델을 불러오는 중이에요', 2);
  await loadModels();
  emit(0, '준비하고 있어요', '준비 완료', 5);
  markStage('model_load');

  // ══════════════════════════════════════════════════════════
  //  Stage 1: Per-image feature extraction (bounded concurrency)
  // ══════════════════════════════════════════════════════════

  log('stage 1 — feature extraction');
  const featureMap = new Map<string, PhotoFeatures>();
  let skippedPhotos = 0;
  const featureExtractionTimes: number[] = [];
  let doneCount = 0;

  const CONCURRENCY = 2;

  async function extractOne(entry: FileEntry): Promise<void> {
    const file = getFile(entry.id);
    const imgStart = performance.now();

    if (!file) { skippedPhotos++; return; }

    try {
      const bmp = await createImageBitmap(file);

      // Face & metadata run async in parallel with sync canvas work
      const faceP = analyzeAllFaces(bmp);
      const metaP = extractMetadata(file, bmp);

      // Single-pass canvas analysis (1 downsample instead of 3)
      const { blur, exposure, composition } = measureAllInOnePass(bmp);
      const sceneEmbed = computeSceneEmbedding(bmp);

      const [face, meta] = await Promise.all([faceP, metaP]);

      // Face-region blur: measure sharpness on detected face areas
      let faceBlur = blur;
      const boxes = face.faceCount > 0 ? face.faces.map((ff) => ff.box) : [];
      if (boxes.length > 0) {
        const regionBlur = measureFaceRegionBlur(bmp, boxes);
        if (regionBlur >= 0) faceBlur = regionBlur;
      }

      // Background simplicity (needs bitmap + face boxes)
      const bgSimplicity = boxes.length > 0 ? measureBgSimplicity(bmp, boxes) : 0.5;

      bmp.close();

      const photoType = classifyPhotoType(face, meta.width, meta.height);
      const framingType = detectFraming(face);
      const hasFaceCut = hasAnyFaceCut(face);

      // Aesthetic scores (computed from already-extracted face data)
      const flattering = computeFlattering(face, framingType);
      const poseNatural = computePoseNatural(face);
      const smileQuality = computeSmileQuality(face);
      const thirdsScore = computeThirdsScore(face);

      featureMap.set(entry.id, {
        fileId: entry.id,
        timestamp: meta.timestamp,
        width: meta.width,
        height: meta.height,
        sceneEmbed,
        blur,
        faceBlur,
        exposure,
        composition,
        face,
        photoType,
        framingType,
        hasFaceCut,
        flattering,
        poseNatural,
        smileQuality,
        bgSimplicity,
        thirdsScore,
      });

      featureExtractionTimes.push(performance.now() - imgStart);
    } catch (err) {
      console.warn(`[pipeline] skip ${entry.name}:`, err);
      skippedPhotos++;
    }
  }

  // Bounded-concurrency runner with backpressure
  let cursor = 0;
  async function runWorker(): Promise<void> {
    while (cursor < manifest.length) {
      const idx = cursor++;
      await extractOne(manifest[idx]);
      doneCount++;
      const pct = 6 + (doneCount / total) * 50;
      emit(1, '사진을 분석하고 있어요', `${doneCount}/${total}장 분석 중`, pct, { processedCount: doneCount });
      // Yield to UI every image
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, manifest.length) }, () => runWorker());
  await Promise.all(workers);

  const features = Array.from(featureMap.values());
  emit(1, '사진을 분석하고 있어요', `${features.length}장 분석 완료`, 57, { processedCount: total });

  const faceCounts = features.map((f) => f.face.faceCount);
  const withFaces = faceCounts.filter((c) => c > 0).length;
  const typeDistro: Record<string, number> = {};
  for (const f of features) typeDistro[f.photoType] = (typeDistro[f.photoType] ?? 0) + 1;
  // Blink detection stats
  let mpBlinkCount = 0;
  let earFallbackCount = 0;
  for (const f of features) {
    for (const face of f.face.faces) {
      if (face.eyeBlinkScore >= 0) mpBlinkCount++;
      else earFallbackCount++;
    }
  }
  console.log(`[pipeline] extracted ${features.length} features from ${total} files (${CONCURRENCY}-way concurrency)`);
  console.log(`[pipeline] face detection: ${withFaces}/${features.length} photos have faces, distribution: [${faceCounts.slice(0, 20).join(',')}${faceCounts.length > 20 ? '...' : ''}]`);
  console.log(`[pipeline] eye-blink: MediaPipe=${mpBlinkCount} faces, EAR-fallback=${earFallbackCount} faces`);
  console.log(`[pipeline] photo types:`, typeDistro);

  // ── Diagnostic: trace specific image through pipeline ──
  const TRACE_PATTERN = '_28.';
  const traceEntry = manifest.find((e) => e.name.includes(TRACE_PATTERN));
  if (traceEntry) {
    const traceF = featureMap.get(traceEntry.id);
    if (traceF) {
      console.log(`%c[TRACE] ${traceEntry.name} (id=${traceEntry.id})`, 'color: #ff6b6b; font-weight:bold');
      console.log(`[TRACE]   faceCount=${traceF.face.faceCount}, rawFaceCount=${traceF.face.rawFaceCount}, type=${traceF.photoType}, framing=${traceF.framingType}`);
      console.log(`[TRACE]   blur=${traceF.blur.toFixed(3)}, exposure=${traceF.exposure.toFixed(3)}, composition=${traceF.composition.toFixed(3)}`);

      // Compare scene embedding with every other image — find top 5 most similar
      const sims: { name: string; id: string; sim: number; faceCount: number; type: string }[] = [];
      for (const [oid, of_] of featureMap) {
        if (oid === traceEntry.id) continue;
        let dot = 0;
        for (let i = 0; i < traceF.sceneEmbed.length; i++) dot += traceF.sceneEmbed[i] * of_.sceneEmbed[i];
        const oName = manifest.find((e) => e.id === oid)?.name ?? oid;
        sims.push({ name: oName, id: oid, sim: dot, faceCount: of_.face.faceCount, type: of_.photoType });
      }
      sims.sort((a, b) => b.sim - a.sim);
      console.log(`[TRACE]   Top 10 most similar (scene embed cosine):`);
      for (const s of sims.slice(0, 10)) {
        console.log(`[TRACE]     ${s.sim.toFixed(4)} | F${s.faceCount} ${s.type} | ${s.name}`);
      }
      console.log(`[TRACE]   Bottom 3 (least similar):`);
      for (const s of sims.slice(-3)) {
        console.log(`[TRACE]     ${s.sim.toFixed(4)} | F${s.faceCount} ${s.type} | ${s.name}`);
      }
    }
  }

  markStage('feature_extraction');

  // ══════════════════════════════════════════════════════════
  //  Stage 2: Coarse scene grouping
  // ══════════════════════════════════════════════════════════

  log('stage 2 — scene grouping');
  emit(2, '장면을 나누고 있어요', '시간순 + 배경으로 장면을 분리하고 있어요', 60);

  const scenes = groupByScene(features);

  console.log(`[pipeline] ${features.length} photos → ${scenes.length} scenes, sizes: [${scenes.map((s) => s.photoIds.length).join(', ')}]`);

  // ── Trace: which scene did the target image land in? ──
  if (traceEntry) {
    for (const sc of scenes) {
      if (sc.photoIds.includes(traceEntry.id)) {
        const scNames = sc.photoIds.map((pid) => manifest.find((e) => e.id === pid)?.name ?? pid);
        console.log(`%c[TRACE] ${traceEntry.name} → ${sc.id} (${sc.photoIds.length} photos)`, 'color: #ff6b6b; font-weight:bold');
        console.log(`[TRACE]   scene members: [${scNames.join(', ')}]`);
        break;
      }
    }
  }

  emit(2, '장면을 나누고 있어요', `${scenes.length}개 장면 발견`, 65, { groupCount: scenes.length });
  markStage('scene_grouping');

  // ══════════════════════════════════════════════════════════
  //  Stage 3: Fine group splitting
  // ══════════════════════════════════════════════════════════

  log('stage 3 — fine group splitting');
  emit(3, '그룹을 정밀 분류하고 있어요', '인원수 + 포즈 + 프레이밍으로 세분화 중', 68);

  const globalGroupIdx = { value: 0 };
  const allGroupDefs: GroupDef[] = [];

  for (let si = 0; si < scenes.length; si++) {
    const groups = splitSceneIntoGroups(scenes[si], featureMap, globalGroupIdx);
    allGroupDefs.push(...groups);
    // Yield every 10 scenes to keep UI responsive
    if ((si + 1) % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  allGroupDefs.sort((a, b) => {
    if (a.isSingleton !== b.isSingleton) return a.isSingleton ? 1 : -1;
    return b.photoIds.length - a.photoIds.length;
  });

  console.log(`[pipeline] ${scenes.length} scenes → ${allGroupDefs.length} groups, sizes: [${allGroupDefs.map((g) => g.photoIds.length).join(', ')}]`);

  // ── Trace: which group did the target image land in? ──
  if (traceEntry) {
    for (const gd of allGroupDefs) {
      if (gd.photoIds.includes(traceEntry.id)) {
        const gdNames = gd.photoIds.map((pid) => manifest.find((e) => e.id === pid)?.name ?? pid);
        console.log(`%c[TRACE] ${traceEntry.name} → ${gd.id} "${gd.label}" (${gd.photoIds.length} photos, singleton=${gd.isSingleton})`, 'color: #ff6b6b; font-weight:bold');
        console.log(`[TRACE]   group members: [${gdNames.join(', ')}]`);
        break;
      }
    }
  }

  emit(3, '그룹을 정밀 분류하고 있어요', `${allGroupDefs.length}개 그룹으로 분류 완료`, 75, { groupCount: allGroupDefs.length });
  markStage('group_splitting');

  // ══════════════════════════════════════════════════════════
  //  Stage 4: Scoring + ranking
  // ══════════════════════════════════════════════════════════

  log('stage 4 — scoring & ranking');
  emit(3, '베스트컷을 고르고 있어요', '선명도 + 표정 + 구도 + 타입 종합 평가 중', 78, { processedCount: total, groupCount: allGroupDefs.length });

  const filteredIds = new Set<string>();
  const rejectSummary: Record<string, number> = {};
  const groups: PhotoGroup[] = [];
  const allRankedList: RankedPhoto[] = [];
  const rankedMap = new Map<string, RankedResult>();
  let softRejectedCount = 0;
  let totalBursts = 0;

  const YIELD_EVERY_N_GROUPS = 20;

  for (let gi = 0; gi < allGroupDefs.length; gi++) {
    const gdef = allGroupDefs[gi];
    let ranked = rankGroup(gdef, featureMap);
    ranked = trimGroup(ranked);

    totalBursts += gdef.burstGroups.filter((b) => b.length > 1).length;

    for (const r of ranked) {
      rankedMap.set(r.fileId, r);
      if (r.rejected) {
        filteredIds.add(r.fileId);
        for (const rr of r.rejectReasons) {
          rejectSummary[rr.code] = (rejectSummary[rr.code] ?? 0) + 1;
          if (rr.severity === 'soft') softRejectedCount++;
        }
      }
    }

    const rankedPhotos = ranked.map((r) => {
      const f = featureMap.get(r.fileId)!;
      return rankedResultToRankedPhoto(r, f);
    });

    const best = rankedPhotos.find((p) => !p.rejected);

    groups.push({
      id: gdef.id,
      label: gdef.label,
      fileIds: gdef.photoIds,
      ranked: rankedPhotos,
      bestFileId: best?.fileId ?? null,
      keptCount: rankedPhotos.filter((p) => !p.rejected).length,
      rejectedCount: rankedPhotos.filter((p) => p.rejected).length,
    });

    allRankedList.push(...rankedPhotos);

    // Yield to UI periodically to prevent blocking
    if ((gi + 1) % YIELD_EVERY_N_GROUPS === 0) {
      const scorePct = 78 + ((gi + 1) / allGroupDefs.length) * 12;
      emit(3, '베스트컷을 고르고 있어요', `${gi + 1}/${allGroupDefs.length} 그룹 평가 중`, scorePct, { processedCount: total, groupCount: gi + 1 });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  allRankedList.sort((a, b) => b.score - a.score);

  const representativePool = groups
    .filter((g) => g.bestFileId)
    .map((g) => {
      const best = g.ranked.find((p) => p.fileId === g.bestFileId)!;
      return best;
    })
    .sort((a, b) => b.score - a.score);

  const topN = Math.min(7, representativePool.length);
  const candidates: Candidate[] = representativePool.slice(0, topN).map((rp, i) => ({
    fileId: rp.fileId,
    score: rp.score,
    qualityScores: rp.qualityScores,
    ...assignCategory(i),
    reason: rp.reason,
  }));

  markStage('scoring_ranking');

  // ══════════════════════════════════════════════════════════
  //  Stage 5: Explainability
  // ══════════════════════════════════════════════════════════

  log('stage 5 — explainability');
  emit(3, '결과를 정리하고 있어요', '판단 근거를 기록하고 있어요', 95, { processedCount: total, groupCount: groups.length });

  // Group evidence
  const groupEvidence = allGroupDefs.map((g) => g.evidence);

  // Recommendation explanations
  const explanations = buildExplanations(groups, allGroupDefs, rankedMap, featureMap);

  // Low confidence items
  const lowConfidenceItems: LowConfidenceItem[] = explanations
    .filter((e) => e.lowConfidence)
    .map((e) => ({
      fileId: e.fileId,
      groupId: e.groupId,
      confidence: e.confidence,
      reasons: e.lowConfidenceReason ? [e.lowConfidenceReason] : [],
    }));

  // Suspicious cases
  const suspiciousCases = detectSuspiciousCases(
    groups,
    total,
    filteredIds.size,
    scenes.length,
  );

  // Processing metrics
  const avgFx = featureExtractionTimes.length > 0
    ? Math.round(featureExtractionTimes.reduce((a, b) => a + b, 0) / featureExtractionTimes.length)
    : 0;

  markStage('explainability');

  const totalTimeMs = stageTimings.reduce((s, t) => s + t.durationMs, 0);

  function stageMs(name: string): number {
    return stageTimings.find((s) => s.name === name)?.durationMs ?? 0;
  }

  const singletonsFound = allGroupDefs.filter((g) => g.isSingleton).length;
  const hardRejectedCount = filteredIds.size - softRejectedCount;

  // Average best-score gap across groups
  const bestScoreGaps: number[] = [];
  for (const g of groups) {
    const alive = g.ranked.filter((r) => !r.rejected);
    if (alive.length >= 2) bestScoreGaps.push(alive[0].score - alive[1].score);
  }
  const averageBestScoreGap = bestScoreGaps.length > 0
    ? bestScoreGaps.reduce((a, b) => a + b, 0) / bestScoreGaps.length
    : 0;

  const metrics: ProcessingMetrics = {
    totalPhotos: total,
    processedPhotos: features.length,
    skippedPhotos,
    totalTimeMs,
    stages: stageTimings,
    avgFeatureExtractionMs: avgFx,
    scenesFound: scenes.length,
    groupsFound: allGroupDefs.length,
    singletonsFound,
    burstsDetected: totalBursts,
    rejectedCount: filteredIds.size,
    softRejectedCount,
    candidateCount: candidates.length,
    rejectDistribution: rejectSummary,

    // Face detection stats
    photosWithFaces: withFaces,
    photoTypeDistribution: typeDistro,

    // Extended metrics
    uploadSizeBytes,
    modelLoadTimeMs: stageMs('model_load'),
    featureExtractionTimeMs: stageMs('feature_extraction'),
    sceneGroupingTimeMs: stageMs('scene_grouping'),
    groupSplittingTimeMs: stageMs('group_splitting'),
    rankingTimeMs: stageMs('scoring_ranking'),
    explainabilityTimeMs: stageMs('explainability'),
    singletonRatio: allGroupDefs.length > 0 ? singletonsFound / allGroupDefs.length : 0,
    hardRejectRatio: total > 0 ? hardRejectedCount / total : 0,
    averageGroupSize: allGroupDefs.length > 0 ? total / allGroupDefs.length : 0,
    averageBestScoreGap,
  };

  // Warnings
  const warnings: string[] = [];
  if (skippedPhotos > 0) warnings.push(`${skippedPhotos}장의 사진을 처리하지 못했어요`);
  if (features.length === 0) warnings.push('처리된 사진이 없어요');

  // Score distribution
  const allScores = allRankedList.map((r) => r.score);
  const scoreDistribution = buildScoreDistribution(allScores);
  const groupSizeDistribution = buildGroupSizeDistribution(groups);

  const likelyFailureReasons = deriveFailureReasons(metrics, scenes.length, suspiciousCases);
  const thresholdTuningCandidates = deriveThresholdCandidates(metrics);

  const failureReport: FailureAnalysisReport = {
    suspiciousCases,
    lowConfidenceItems,
    metrics,
    warnings,
    groupSizeDistribution,
    scoreDistribution,

    // Extended failure analysis
    totalScenes: scenes.length,
    totalBursts: totalBursts,
    singletonCount: singletonsFound,
    hardRejectedCount,
    likelyFailureReasons,
    thresholdTuningCandidates,
  };

  // Log metrics summary
  console.log('[pipeline] metrics:', JSON.stringify({
    totalTimeMs,
    stages: stageTimings.map((s) => `${s.name}:${s.durationMs}ms`),
    scenes: scenes.length,
    groups: allGroupDefs.length,
    singletons: metrics.singletonsFound,
    bursts: totalBursts,
    rejected: filteredIds.size,
    suspicious: suspiciousCases.length,
    lowConfidence: lowConfidenceItems.length,
  }));

  emit(3, '베스트컷을 고르고 있어요', '완료!', 100, { processedCount: total, groupCount: groups.length });
  timer.end();

  console.log(`[pipeline] DONE — ${groups.length} groups, ${candidates.length} candidates, ${filteredIds.size} filtered`);

  // Build face debug data from feature map
  const faceDebug: Record<string, FaceBoxData> = {};
  for (const [fid, feat] of featureMap) {
    faceDebug[fid] = {
      faceCount: feat.face.faceCount,
      rawFaceCount: feat.face.rawFaceCount,
      worstEAR: feat.face.worstEAR,
      faces: feat.face.faces.map((f) => ({
        box: { ...f.box },
        confidence: f.confidence,
        size: f.size,
        ear: f.ear,
        minEyeEAR: f.minEyeEAR,
        normEAR: Math.min(1, Math.max(0, (f.minEyeEAR - 0.15) / 0.20)),
        eyeContrast: f.eyeContrast,
        eyeBlinkScore: f.eyeBlinkScore,
        expression: f.expression.best,
      })),
    };
  }

  return {
    uploadId,
    totalCount: total,
    groupCount: groups.length,
    filteredCount: filteredIds.size,
    rejectedCount: filteredIds.size,
    rejectSummary,
    candidateCount: candidates.length,
    groups,
    filteredIds: Array.from(filteredIds),
    candidates,
    allRanked: allRankedList,

    // Face detection debug
    faceDebug,

    // Explainability
    metrics,
    failureReport,
    explanations,
    groupEvidence,
  };
}

// ─── Phase 1: Quick Scan (scene classification only) ────

export interface QuickScanScene {
  id: string;
  photoIds: string[];
  photoCount: number;
  representativeFileId: string;
}

export interface QuickScanResult {
  totalCount: number;
  sceneCount: number;
  scenes: QuickScanScene[];
  processingTimeMs: number;
}

export interface QuickScanProgress {
  stage: number;
  stageLabel: string;
  stageDetail: string;
  overallProgress: number;
  processedCount: number;
  sceneCount: number;
}

const QUICK_SCAN_CONCURRENCY = 4;
const QUICK_THUMB_SIZE = 256;

export async function runQuickScan(
  manifest: FileEntry[],
  onProgress: (u: QuickScanProgress) => void,
): Promise<QuickScanResult> {
  const startTime = performance.now();
  const total = manifest.length;
  ruleTracker.reset();

  function emit(stage: number, label: string, detail: string, pct: number, extra: Partial<QuickScanProgress> = {}) {
    onProgress({
      stage,
      stageLabel: label,
      stageDetail: detail,
      overallProgress: Math.min(100, Math.round(pct)),
      processedCount: extra.processedCount ?? 0,
      sceneCount: extra.sceneCount ?? 0,
    });
  }

  emit(0, '빠르게 정리하고 있어요', '사진을 훑어보는 중', 2);

  const DUMMY_FACE: FaceResult = {
    faceCount: 0,
    rawFaceCount: 0,
    faces: [],
    worstEAR: 0.7,
    bestFaceRatio: 0,
    avgFacePosition: { x: 0.5, y: 0.5 },
    worstExpression: 0.5,
  };

  const features: PhotoFeatures[] = [];
  let doneCount = 0;

  async function scanOne(entry: FileEntry): Promise<PhotoFeatures | null> {
    const file = getFile(entry.id);
    if (!file) return null;

    try {
      const bmp = await createImageBitmap(file, {
        resizeWidth: QUICK_THUMB_SIZE,
        resizeHeight: QUICK_THUMB_SIZE,
        resizeQuality: 'low',
      });

      const sceneEmbed = computeSceneEmbedding(bmp);
      bmp.close();

      const timestamp = await extractTimestamp(file);

      return {
        fileId: entry.id,
        timestamp,
        width: 0,
        height: 0,
        sceneEmbed,
        blur: 0,
        faceBlur: 0,
        exposure: 0.5,
        composition: 0.5,
        face: DUMMY_FACE,
        photoType: 'landscape',
        framingType: 'wide',
        hasFaceCut: false,
        flattering: 0.5,
        poseNatural: 0.5,
        smileQuality: 0.5,
        bgSimplicity: 0.5,
        thirdsScore: 0.5,
      };
    } catch (err) {
      console.warn(`[quickscan] skip ${entry.name}:`, err);
      return null;
    }
  }

  let cursor = 0;
  async function runWorker(): Promise<void> {
    while (cursor < manifest.length) {
      const idx = cursor++;
      const result = await scanOne(manifest[idx]);
      if (result) features.push(result);
      doneCount++;
      const pct = 5 + (doneCount / total) * 80;
      emit(1, '빠르게 정리하고 있어요', `${doneCount}/${total}장 스캔 중`, pct, { processedCount: doneCount });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const workers = Array.from(
    { length: Math.min(QUICK_SCAN_CONCURRENCY, manifest.length) },
    () => runWorker(),
  );
  await Promise.all(workers);

  emit(1, '빠르게 정리하고 있어요', `${features.length}장 스캔 완료`, 88, { processedCount: total });

  emit(2, '장면을 나누고 있어요', '비슷한 장면끼리 묶는 중', 90);
  const scenes = groupByScene(features);

  console.log(`[quickscan] ${features.length} photos → ${scenes.length} scenes, sizes: [${scenes.map((s) => s.photoIds.length).join(', ')}]`);

  const quickScenes: QuickScanScene[] = scenes.map((s) => ({
    id: s.id,
    photoIds: s.photoIds,
    photoCount: s.photoIds.length,
    representativeFileId: s.photoIds[0],
  }));

  quickScenes.sort((a, b) => b.photoCount - a.photoCount);

  const processingTimeMs = performance.now() - startTime;

  emit(2, '정리 완료!', `${scenes.length}개 장면 발견`, 100, { processedCount: total, sceneCount: scenes.length });

  console.log(`[quickscan] DONE in ${(processingTimeMs / 1000).toFixed(1)}s — ${scenes.length} scenes from ${features.length} photos`);

  return {
    totalCount: total,
    sceneCount: quickScenes.length,
    scenes: quickScenes,
    processingTimeMs,
  };
}
