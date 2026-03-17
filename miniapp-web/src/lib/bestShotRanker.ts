/**
 * Multi-axis best-shot ranking with photo-type-specific weights.
 *
 * All thresholds and weights are read from ScoringConfig (analysisConfig.ts).
 * Rule firings are tracked via ruleTracker.
 *
 * Score axes:
 *   1. Technical  — blur, exposure, clipping proxy
 *   2. Subject    — eyeOpen, faceVisibility, expression, face edge-cut
 *   3. Composition — centering, framing stability
 *   4. Context    — photo-type-specific bonuses
 *   5. Uniqueness — penalty for near-duplicates within the same group
 */

import type { PhotoFeatures, PhotoType } from './photoTypes';
import type { GroupDef } from './groupSplitter';
import type {
  BestShotScoreBreakdown,
  TechnicalDetail,
  SubjectDetail,
  CompositionDetail,
  ContextDetail,
  UniquenessDetail,
  AestheticsDetail,
  RejectReason,
} from './explainability';
import { getScoringConfig, ruleTracker } from './analysisConfig';

// ─── Legacy score breakdown (kept for mockAnalysis compat) ─

export interface ScoreBreakdown {
  technical: number;
  subject: number;
  compositionScore: number;
  context: number;
  uniqueness: number;
  aesthetics: number;
  total: number;
}

export interface RankedResult {
  fileId: string;
  breakdown: ScoreBreakdown;
  detailedBreakdown: BestShotScoreBreakdown;
  rejected: boolean;
  rejectReason: string | null;
  rejectReasons: RejectReason[];
  tags: string[];
  reason: string;
  confidence: number;
}

// ─── Hard filters (structured, config-driven) ────────────

interface HardFilterDef {
  code: string;
  label: string;
  metric: string;
  getThreshold: () => number;
  check: (f: PhotoFeatures) => boolean;
  getValue: (f: PhotoFeatures) => number;
}

function buildHardFilters(): HardFilterDef[] {
  const cfg = getScoringConfig().hardFilters;
  return [
    {
      code: 'BLUR_SEVERE',
      label: '초점이 흐려요',
      metric: 'blur',
      getThreshold: () => cfg.blurSevere,
      check: (f) => f.blur < cfg.blurSevere,
      getValue: (f) => f.blur,
    },
    {
      code: 'FACE_BLUR',
      label: '얼굴이 흐려요',
      metric: 'faceBlur',
      getThreshold: () => cfg.faceBlurSevere,
      check: (f) => f.face.faceCount > 0 && f.faceBlur < cfg.faceBlurSevere,
      getValue: (f) => f.faceBlur,
    },
    {
      code: 'EYE_CLOSED',
      label: '눈을 감은 사람이 있어요',
      metric: 'worstEAR',
      getThreshold: () => cfg.eyeClosed,
      check: (f) => {
        if (f.face.faceCount === 0) return false;
        for (let fi = 0; fi < f.face.faces.length; fi++) {
          const face = f.face.faces[fi];
          const blink = face.eyeBlinkScore;
          const tag = `[EYE_CHECK ${f.fileId}#${fi}]`;
          const rawEAR = face.minEyeEAR;
          const expr = face.expression.best;

          // Primary: MediaPipe blendshape blink score (avg of both eyes, angle-corrected)
          // Score is already averaged + penalized for left/right disagreement,
          // so 0.45 = both eyes clearly closed
          if (blink >= 0) {
            if (blink > 0.45) {
              console.log(`${tag} REJECT mediapipe: blink=${blink.toFixed(3)} EAR=${rawEAR.toFixed(3)} sz=${face.size.toFixed(3)} ${expr}`);
              ruleTracker.fire('눈 감음 필터');
              return true;
            }
            continue;
          }

          // Fallback: EAR-based multi-tier (when MediaPipe unavailable — blink === -1)
          // Tier 1: very low EAR → almost certainly closed
          if (rawEAR < 0.20) {
            console.log(`${tag} REJECT ear-t1: EAR=${rawEAR.toFixed(3)} sz=${face.size.toFixed(3)} ${expr}`);
            ruleTracker.fire('눈 감음 필터');
            return true;
          }
          // Tier 2: low EAR + non-happy expression → likely closed
          if (rawEAR < 0.25 && expr !== 'happy') {
            console.log(`${tag} REJECT ear-t2: EAR=${rawEAR.toFixed(3)} sz=${face.size.toFixed(3)} ${expr}`);
            ruleTracker.fire('눈 감음 필터');
            return true;
          }
          // Tier 3: moderately low EAR + sad expression → squinting/closing
          if (rawEAR < 0.28 && expr === 'sad') {
            console.log(`${tag} REJECT ear-t3: EAR=${rawEAR.toFixed(3)} sz=${face.size.toFixed(3)} ${expr}`);
            ruleTracker.fire('눈 감음 필터');
            return true;
          }
        }
        return false;
      },
      getValue: (f) => {
        const worstBlink = Math.max(...f.face.faces.map((face) => face.eyeBlinkScore));
        return worstBlink >= 0 ? 1 - worstBlink : f.face.worstEAR;
      },
    },
    {
      code: 'FACE_CUT',
      label: '얼굴이 잘려 있어요',
      metric: 'hasFaceCut',
      getThreshold: () => 0,
      check: (f) => cfg.faceCutEnabled && f.face.faceCount > 0 && f.hasFaceCut,
      getValue: (f) => (f.hasFaceCut ? 1 : 0),
    },
    {
      code: 'EXPOSURE_EXTREME',
      label: '너무 어둡거나 밝아요',
      metric: 'exposure',
      getThreshold: () => cfg.exposureExtreme,
      check: (f) => f.exposure < cfg.exposureExtreme,
      getValue: (f) => f.exposure,
    },
    {
      code: 'FACE_TOO_SMALL',
      label: '얼굴이 너무 작아요',
      metric: 'minFaceSize',
      getThreshold: () => cfg.faceTooSmall,
      check: (f) => {
        if (f.face.faceCount === 0) return false;
        return Math.min(...f.face.faces.map((ff) => ff.size)) < cfg.faceTooSmall;
      },
      getValue: (f) =>
        f.face.faceCount > 0
          ? Math.min(...f.face.faces.map((ff) => ff.size))
          : 1,
    },
  ];
}

function applyHardFilters(f: PhotoFeatures): RejectReason[] {
  const filters = buildHardFilters();
  const reasons: RejectReason[] = [];
  for (const filter of filters) {
    if (filter.check(f)) {
      ruleTracker.fire(`HARD_${filter.code}`);
      reasons.push({
        code: filter.code,
        label: filter.label,
        severity: 'hard',
        metric: filter.metric,
        value: filter.getValue(f),
        threshold: filter.getThreshold(),
      });
    }
  }
  return reasons;
}

// ─── Axis scoring (config-driven) ────────────────────────

function scoreTechnical(f: PhotoFeatures): TechnicalDetail {
  const cfg = getScoringConfig().technical;
  // Use face-region blur when available — catches motion blur on faces that global blur misses
  const rawSharpness = f.face.faceCount > 0 ? Math.min(f.blur, f.faceBlur) : f.blur;
  // Non-linear sharpness: cubed for steeper penalty on soft/blurry images
  const sharpness = rawSharpness * rawSharpness * rawSharpness;
  const exposure = f.exposure;
  const compositionContrib = f.composition;

  const s = sharpness * cfg.sharpnessWeight;
  const eBase = exposure * cfg.exposureBaseWeight;
  const eBonus = exposure > cfg.exposureBonusThreshold ? cfg.exposureBonusWeight : exposure * cfg.exposureBonusWeight;
  const cBonus = compositionContrib * cfg.compositionWeight;
  const score = Math.min(1, s + eBase + eBonus + cBonus);

  return { score, sharpness: rawSharpness, exposure, compositionContrib };
}

function scoreSubject(f: PhotoFeatures): SubjectDetail {
  const cfg = getScoringConfig().subject;

  if (f.face.faceCount === 0) {
    return {
      score: cfg.noFaceScore,
      eyeOpenNorm: 0.7,
      expressionNorm: 0.5,
      visibilityNorm: 0,
      centeringNorm: 0.5,
      faceCutPenalty: 0,
      hasFace: false,
    };
  }

  const earNorm = Math.min(1, Math.max(0, (f.face.worstEAR - cfg.earBaseOffset) / cfg.earRange));
  const exprNorm = f.face.worstExpression;
  const smallestFace = Math.min(...f.face.faces.map((ff) => ff.size));
  const visibilityNorm = Math.min(1, smallestFace * cfg.visibilityMultiplier);
  const faceCutPenalty = f.hasFaceCut ? cfg.faceCutPenaltyValue : 0;

  const posX = f.face.avgFacePosition.x;
  const posY = f.face.avgFacePosition.y;
  const centerDist = Math.sqrt((posX - 0.5) ** 2 + (posY - 0.45) ** 2);
  const centeringNorm = Math.max(0, 1 - centerDist * cfg.centerDistMultiplier);

  // Detection confidence bonus: high-confidence faces → clearer, better lit → higher quality indicator
  const avgConf = f.face.faces.reduce((s, ff) => s + ff.confidence, 0) / f.face.faces.length;
  const confBonus = Math.max(0, (avgConf - 0.6) * 0.3);

  // Eye openness scoring: prefer MediaPipe blink score, fallback to EAR
  let eyeOpenScore = 1;
  for (const face of f.face.faces) {
    if (face.eyeBlinkScore >= 0) {
      const openness = 1 - face.eyeBlinkScore;
      if (openness < eyeOpenScore) eyeOpenScore = openness;
    } else {
      // Map raw EAR to 0–1 openness: 0.18→0, 0.32→1
      const ne = Math.min(1, Math.max(0, (face.minEyeEAR - 0.18) / 0.14));
      if (ne < eyeOpenScore) eyeOpenScore = ne;
    }
  }
  const effectiveEarNorm = Math.min(earNorm, eyeOpenScore);

  // Damping for borderline eyes (passed hard filter but still not great)
  const earDamping = effectiveEarNorm < 0.3 ? 0.40 : effectiveEarNorm < 0.55 ? 0.65 : effectiveEarNorm < 0.75 ? 0.85 : 1.0;

  const rawScore =
    effectiveEarNorm * cfg.eyeOpenWeight +
    exprNorm * cfg.expressionWeight +
    visibilityNorm * cfg.visibilityWeight +
    centeringNorm * cfg.centeringWeight +
    (1 - faceCutPenalty) * cfg.faceCutWeight +
    confBonus;
  const score = Math.min(1, rawScore * earDamping);

  return { score, eyeOpenNorm: earNorm, expressionNorm: exprNorm, visibilityNorm, centeringNorm, faceCutPenalty, hasFace: true };
}

function scoreComposition(f: PhotoFeatures): CompositionDetail {
  const cfg = getScoringConfig().composition;
  const baseScore = f.composition;
  let framingBonus = 0;

  if (f.face.faceCount > 0) {
    const mainArea = f.face.bestFaceRatio;
    if (f.framingType === 'closeup' && mainArea > cfg.closeupMinArea) framingBonus = cfg.closeupBonus;
    if (f.framingType === 'half_body') framingBonus = cfg.halfBodyBonus;
  }

  const score = Math.min(1, baseScore + framingBonus);
  return { score, baseScore, framingBonus, framingType: f.framingType };
}

function scoreContext(f: PhotoFeatures): ContextDetail {
  const cfg = getScoringConfig().context;
  let score: number;
  let typeMatchReason: string;

  ruleTracker.fire(`TYPE_${f.photoType.toUpperCase()}`);

  switch (f.photoType) {
    case 'selfie':
      score = f.face.faceCount === 1 && f.face.bestFaceRatio > cfg.selfieFaceRatioMin ? 0.8 : 0.5;
      typeMatchReason = score > 0.6 ? '셀카에 적합한 얼굴 크기' : '셀카 조건 부분 충족';
      break;
    case 'group_photo': {
      const allEyesOpen = f.face.worstEAR > cfg.groupAllEyesOpenEAR;
      const allVisible = Math.min(...f.face.faces.map((ff) => ff.size)) > cfg.groupAllVisibleMinSize;
      score = (allEyesOpen ? 0.4 : 0) + (allVisible ? 0.4 : 0) + 0.2;
      typeMatchReason = `단체사진 — 눈뜸:${allEyesOpen ? 'O' : 'X'}, 모두보임:${allVisible ? 'O' : 'X'}`;
      break;
    }
    case 'travel_portrait':
      score = f.face.faceCount > 0 && f.composition > cfg.travelCompositionMin ? 0.8 : 0.5;
      typeMatchReason = '여행 인물 — 사람+배경 균형';
      break;
    case 'landscape':
      score = f.blur > cfg.landscapeBlurMin && f.composition > cfg.landscapeCompositionMin ? 0.85 : 0.5;
      typeMatchReason = '풍경 — 구도+선명도 중심';
      break;
    default:
      score = 0.5;
      typeMatchReason = '일반 인물';
      break;
  }

  return { score, photoType: f.photoType, typeMatchReason };
}

// ─── Uniqueness penalty (config-driven, bounded O(n×k)) ──

const UNIQUENESS_SAMPLE_CAP = 20;

function computeUniqueness(
  fileId: string,
  group: GroupDef,
  featureMap: Map<string, PhotoFeatures>,
): UniquenessDetail {
  const cfg = getScoringConfig().uniqueness;
  const f = featureMap.get(fileId)!;

  let inBurst = false;
  for (const burst of group.burstGroups) {
    if (burst.includes(fileId) && burst.length > 1) {
      inBurst = true;
      break;
    }
  }

  // Bounded comparison: sample up to UNIQUENESS_SAMPLE_CAP neighbors
  const others = group.photoIds.filter((id) => id !== fileId);
  let compareIds: string[];
  if (others.length <= UNIQUENESS_SAMPLE_CAP) {
    compareIds = others;
  } else {
    const selfIdx = group.photoIds.indexOf(fileId);
    const half = Math.floor(UNIQUENESS_SAMPLE_CAP / 2);
    const neighbors = new Set<string>();
    for (let d = 1; neighbors.size < Math.min(half, others.length); d++) {
      if (selfIdx - d >= 0) neighbors.add(group.photoIds[selfIdx - d]);
      if (selfIdx + d < group.photoIds.length) neighbors.add(group.photoIds[selfIdx + d]);
    }
    // Fill remaining with evenly-spaced samples
    const step = Math.max(1, Math.floor(others.length / (UNIQUENESS_SAMPLE_CAP - neighbors.size)));
    for (let i = 0; i < others.length && neighbors.size < UNIQUENESS_SAMPLE_CAP; i += step) {
      neighbors.add(others[i]);
    }
    compareIds = Array.from(neighbors);
  }

  let maxSim = 0;
  let mostSimilarPhotoId: string | null = null;
  const embed = f.sceneEmbed;
  for (const otherId of compareIds) {
    const other = featureMap.get(otherId);
    if (!other) continue;
    const otherEmbed = other.sceneEmbed;
    let dot = 0;
    for (let i = 0; i < embed.length; i++) dot += embed[i] * otherEmbed[i];
    if (dot > maxSim) {
      maxSim = dot;
      mostSimilarPhotoId = otherId;
    }
  }

  let score: number;
  if (inBurst) {
    score = cfg.burstScore;
    ruleTracker.fire('UNIQUENESS_BURST');
  } else if (maxSim > cfg.highSimThreshold) {
    score = cfg.highSimScore;
    ruleTracker.fire('UNIQUENESS_HIGH_SIM');
  } else if (maxSim > cfg.medSimThreshold) {
    score = cfg.medSimScore;
    ruleTracker.fire('UNIQUENESS_MED_SIM');
  } else {
    score = cfg.defaultScore;
  }

  return { score, inBurst, maxGroupSimilarity: maxSim, mostSimilarPhotoId };
}

// ─── Aesthetics scoring ──────────────────────────────────

function scoreAesthetics(f: PhotoFeatures): AestheticsDetail {
  return {
    score: f.flattering * 0.25 + f.poseNatural * 0.20 + f.smileQuality * 0.25 + f.bgSimplicity * 0.15 + f.thirdsScore * 0.15,
    flattering: f.flattering,
    poseNatural: f.poseNatural,
    smileQuality: f.smileQuality,
    bgSimplicity: f.bgSimplicity,
    thirdsScore: f.thirdsScore,
  };
}

// ─── Compute detailed breakdown ──────────────────────────

function computeDetailedBreakdown(
  f: PhotoFeatures,
  group: GroupDef,
  featureMap: Map<string, PhotoFeatures>,
): BestShotScoreBreakdown {
  const cfg = getScoringConfig();
  const tech = scoreTechnical(f);
  const subj = scoreSubject(f);
  const comp = scoreComposition(f);
  const ctx = scoreContext(f);
  const uniq = computeUniqueness(f.fileId, group, featureMap);
  const aest = scoreAesthetics(f);

  const w = cfg.typeWeights[f.photoType];
  const base =
    tech.score * w.technical +
    subj.score * w.subject +
    comp.score * w.composition +
    ctx.score * w.context +
    aest.score * w.aesthetics;
  // Subtractive uniqueness penalty
  const uniquenessPenalty = (1 - uniq.score) * cfg.uniquenessPenaltyWeight;
  let raw = base - uniquenessPenalty;

  // Borderline blur damping: even if above hard filter, soft images get penalized
  const effectiveBlur = f.face.faceCount > 0 ? Math.min(f.blur, f.faceBlur) : f.blur;
  if (effectiveBlur < 0.40) raw *= 0.70;
  else if (effectiveBlur < 0.55) raw *= 0.85;

  // Contrast stretching: amplify differences. S-curve pushes good scores up and bad scores down.
  const stretched = 1 / (1 + Math.exp(-8 * (raw - 0.5)));
  const total = Math.min(1, Math.max(0, stretched));

  return {
    total,
    confidence: 0,
    technical: tech,
    subject: subj,
    composition: comp,
    context: ctx,
    uniqueness: uniq,
    aesthetics: aest,
    appliedWeights: { technical: w.technical, subject: w.subject, composition: w.composition, context: w.context, aesthetics: w.aesthetics },
  };
}

// ─── Tag generation (config-driven) ──────────────────────

function generateTags(f: PhotoFeatures, detailed: BestShotScoreBreakdown): string[] {
  const cfg = getScoringConfig().tags;
  const tags: string[] = [];
  const hasFace = f.face.faceCount > 0;

  if (hasFace && f.face.worstEAR > cfg.eyeOpenEAR) tags.push('눈 뜸');
  if (hasFace && f.face.worstExpression > cfg.goodExpression) tags.push('좋은 표정');
  if (f.blur > cfg.sharpBlur) tags.push('선명함');
  if (f.composition > cfg.stableComposition) tags.push('구도 안정적');
  if (f.exposure > cfg.goodExposure) tags.push('밝기 좋음');
  if (hasFace && !f.hasFaceCut && detailed.subject.score > cfg.faceVisibleSubjectScore) tags.push('얼굴 잘 보임');
  if (f.photoType === 'selfie' && detailed.total > cfg.profileCandidateTotal) tags.push('프사 후보');

  return tags.slice(0, 4);
}

// ─── Reason generation (config-driven) ───────────────────

function generateReason(f: PhotoFeatures, detailed: BestShotScoreBreakdown): string {
  const cfg = getScoringConfig();
  if (detailed.total > cfg.topTierScoreThreshold) {
    return f.face.faceCount > 0 ? '표정, 구도, 선명도 모두 좋아요' : '구도와 선명도 모두 좋아요';
  }

  const hasFace = f.face.faceCount > 0;

  interface Phrase { score: number; adj: string; end: string }
  const pool: Phrase[] = [
    { score: f.blur, adj: '선명하고', end: '선명하게 잘 나왔어요' },
    { score: f.composition, adj: '구도가 안정적이고', end: '구도가 안정적이에요' },
    { score: f.exposure, adj: '밝기가 좋고', end: '밝기가 적절해요' },
  ];

  if (hasFace) {
    pool.push(
      { score: detailed.subject.eyeOpenNorm, adj: '표정이 자연스럽고', end: '자연스러운 표정이에요' },
      { score: detailed.subject.expressionNorm, adj: '밝은 표정이고', end: '표정이 밝아요' },
    );
    if (!f.hasFaceCut) {
      pool.push({ score: detailed.subject.score, adj: '얼굴이 잘 보이고', end: '얼굴이 잘 보여요' });
    }
  }

  pool.sort((a, b) => b.score - a.score);

  if (pool.length >= 2) return `${pool[0].adj} ${pool[1].end}`;
  if (pool.length === 1) return pool[0].end;
  return '전체적으로 무난한 사진이에요';
}

// ─── Confidence per result (config-driven) ───────────────

function computeResultConfidence(
  detailed: BestShotScoreBreakdown,
  rejected: boolean,
  groupSize: number,
  scoreGapToNext: number,
  hasFace: boolean,
): number {
  const cfg = getScoringConfig().confidence;

  if (rejected) return cfg.rejectedConfidence;

  let conf = cfg.base;
  conf += Math.min(cfg.maxGapBonus, scoreGapToNext * cfg.scoreGapMultiplier);
  if (hasFace) conf += cfg.faceBonus;
  if (detailed.total > cfg.highScoreThreshold) conf += cfg.highScoreBonus;
  else if (detailed.total > cfg.medScoreThreshold) conf += cfg.medScoreBonus;
  if (groupSize === 1) conf = Math.min(conf, cfg.singletonCap);

  return Math.min(1, Math.max(0.1, conf));
}

// ─── Public API ──────────────────────────────────────────

export function rankGroup(
  group: GroupDef,
  featureMap: Map<string, PhotoFeatures>,
): RankedResult[] {
  const cfg = getScoringConfig();
  const results: RankedResult[] = [];

  for (const fileId of group.photoIds) {
    const f = featureMap.get(fileId);
    if (!f) continue;

    const rejectReasons = applyHardFilters(f);
    const rejected = rejectReasons.length > 0;
    const rejectReason = rejected ? rejectReasons[0].label : null;

    const detailed = computeDetailedBreakdown(f, group, featureMap);

    if (rejected) {
      detailed.total = Math.min(detailed.total, cfg.rejectedScoreCap);
    }

    const breakdown: ScoreBreakdown = {
      technical: detailed.technical.score,
      subject: detailed.subject.score,
      compositionScore: detailed.composition.score,
      context: detailed.context.score,
      uniqueness: detailed.uniqueness.score,
      aesthetics: detailed.aesthetics.score,
      total: detailed.total,
    };

    results.push({
      fileId,
      breakdown,
      detailedBreakdown: detailed,
      rejected,
      rejectReason,
      rejectReasons,
      tags: rejected ? [] : generateTags(f, detailed),
      reason: rejected && rejectReason ? rejectReason : generateReason(f, detailed),
      confidence: 0,
    });
  }

  results.sort((a, b) => b.breakdown.total - a.breakdown.total);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const f = featureMap.get(r.fileId)!;
    const nextScore = i < results.length - 1 ? results[i + 1].breakdown.total : 0;
    const gap = r.breakdown.total - nextScore;
    r.confidence = computeResultConfidence(
      r.detailedBreakdown,
      r.rejected,
      group.photoIds.length,
      gap,
      f.face.faceCount > 0,
    );
    r.detailedBreakdown.confidence = r.confidence;
  }

  return results;
}

function buildTrimReason(trimmed: RankedResult, best: RankedResult | undefined, rank: number): string {
  if (!best) return '같은 장면에서 더 좋은 사진이 있어요';

  const diff = best.breakdown.total - trimmed.breakdown.total;

  if (diff < 0.03) {
    return `대표컷과 거의 비슷하지만 미세한 차이로 제외됐어요 (${rank}위)`;
  }

  const axes: { label: string; particle: string; gap: number }[] = [
    { label: '선명도', particle: '가', gap: best.breakdown.technical - trimmed.breakdown.technical },
    { label: '표정', particle: '이', gap: best.breakdown.subject - trimmed.breakdown.subject },
    { label: '구도', particle: '가', gap: best.breakdown.compositionScore - trimmed.breakdown.compositionScore },
    { label: '미적 요소', particle: '가', gap: best.breakdown.aesthetics - trimmed.breakdown.aesthetics },
  ];
  axes.sort((a, b) => b.gap - a.gap);

  const worst = axes[0];
  if (worst.gap > 0.05) {
    if (axes.length >= 2 && axes[1].gap > 0.05) {
      return `대표컷보다 ${worst.label}, ${axes[1].label}${axes[1].particle} 부족해요 (${rank}위)`;
    }
    return `대표컷보다 ${worst.label}${worst.particle} 조금 부족해요 (${rank}위)`;
  }

  return `같은 장면에서 더 좋은 사진이 있어요 (${rank}위)`;
}

export function trimGroup(ranked: RankedResult[], keepRatio?: number): RankedResult[] {
  const ratio = keepRatio ?? getScoringConfig().trimKeepRatio;
  const alive = ranked.filter((r) => !r.rejected);
  const keep = Math.max(1, Math.ceil(alive.length * ratio));
  const keepIds = new Set(alive.slice(0, keep).map((r) => r.fileId));
  const best = alive[0];

  let aliveIdx = 0;
  return ranked.map((r) => {
    if (r.rejected) return r;
    aliveIdx++;
    if (!keepIds.has(r.fileId)) {
      ruleTracker.fire('SOFT_GROUP_TRIM');
      const softReject: RejectReason = {
        code: 'GROUP_TRIM',
        label: '그룹 내 하위 품질',
        severity: 'soft',
        metric: 'group_rank',
        value: aliveIdx,
        threshold: keep,
      };
      return {
        ...r,
        rejected: true,
        rejectReason: softReject.label,
        rejectReasons: [...r.rejectReasons, softReject],
        reason: buildTrimReason(r, best, aliveIdx),
      };
    }
    return r;
  });
}
