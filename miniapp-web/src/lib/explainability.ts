/**
 * Explainability & failure analysis — types and utilities.
 *
 * Layered on top of the existing recommendation engine:
 * records decision evidence without modifying core scoring logic.
 *
 * Answers five questions:
 *   1. 왜 이 사진이 대표컷이 되었는가?
 *   2. 왜 이 사진은 탈락했는가?
 *   3. 왜 이 두 사진은 같은 그룹인가?
 *   4. 왜 이 두 사진은 다른 그룹인가?
 *   5. 어떤 추천이 low confidence인가?
 */

import type { PhotoType, FramingType, PhotoFeatures } from './photoTypes';
import { getScoringConfig, getGroupingConfig } from './analysisConfig';

// ═══════════════════════════════════════════════════════════
//  BestShotScoreBreakdown
// ═══════════════════════════════════════════════════════════

export interface TechnicalDetail {
  score: number;
  sharpness: number;
  exposure: number;
  compositionContrib: number;
}

export interface SubjectDetail {
  score: number;
  eyeOpenNorm: number;
  expressionNorm: number;
  visibilityNorm: number;
  centeringNorm: number;
  faceCutPenalty: number;
  hasFace: boolean;
}

export interface CompositionDetail {
  score: number;
  baseScore: number;
  framingBonus: number;
  framingType: FramingType;
}

export interface ContextDetail {
  score: number;
  photoType: PhotoType;
  typeMatchReason: string;
}

export interface UniquenessDetail {
  score: number;
  inBurst: boolean;
  maxGroupSimilarity: number;
  mostSimilarPhotoId: string | null;
}

export interface AestheticsDetail {
  score: number;
  flattering: number;
  poseNatural: number;
  smileQuality: number;
  bgSimplicity: number;
  thirdsScore: number;
}

export interface BestShotScoreBreakdown {
  total: number;
  confidence: number;
  technical: TechnicalDetail;
  subject: SubjectDetail;
  composition: CompositionDetail;
  context: ContextDetail;
  uniqueness: UniquenessDetail;
  aesthetics: AestheticsDetail;
  appliedWeights: {
    technical: number;
    subject: number;
    composition: number;
    context: number;
    aesthetics: number;
  };
}

// ═══════════════════════════════════════════════════════════
//  RejectReason
// ═══════════════════════════════════════════════════════════

export interface RejectReason {
  code: string;
  label: string;
  severity: 'hard' | 'soft';
  metric: string;
  value: number;
  threshold: number;
}

// ═══════════════════════════════════════════════════════════
//  GroupingDecisionEvidence
// ═══════════════════════════════════════════════════════════

export interface SplitRuleApplication {
  rule: 'face_count' | 'framing' | 'identity' | 'layout';
  description: string;
  threshold: number | string;
  bucketsAfter: number;
}

export interface GroupingDecisionEvidence {
  groupId: string;
  sceneId: string;
  appliedRules: SplitRuleApplication[];
  memberCount: number;
  faceCount: number;
  framingType: string;
  burstSubgroups: number;
  isSingleton: boolean;
}

// ═══════════════════════════════════════════════════════════
//  RecommendationExplanation
// ═══════════════════════════════════════════════════════════

export interface RecommendationExplanation {
  fileId: string;
  groupId: string;
  rank: number;
  isRepresentative: boolean;
  scoreBreakdown: BestShotScoreBreakdown;
  rejectReasons: RejectReason[];
  whySelected: string[];
  comparedTo: { fileId: string; scoreDiff: number; mainAdvantage: string }[];
  confidence: number;
  lowConfidence: boolean;
  lowConfidenceReason: string | null;
}

// ═══════════════════════════════════════════════════════════
//  ProcessingMetrics
// ═══════════════════════════════════════════════════════════

export interface StageTiming {
  name: string;
  durationMs: number;
}

export interface ProcessingMetrics {
  totalPhotos: number;
  processedPhotos: number;
  skippedPhotos: number;
  totalTimeMs: number;
  stages: StageTiming[];
  avgFeatureExtractionMs: number;
  scenesFound: number;
  groupsFound: number;
  singletonsFound: number;
  burstsDetected: number;
  rejectedCount: number;
  softRejectedCount: number;
  candidateCount: number;
  rejectDistribution: Record<string, number>;

  // Face detection stats
  photosWithFaces?: number;
  photoTypeDistribution?: Record<string, number>;

  // Extended metrics for offline evaluation
  uploadSizeBytes?: number;
  modelLoadTimeMs?: number;
  featureExtractionTimeMs?: number;
  sceneGroupingTimeMs?: number;
  groupSplittingTimeMs?: number;
  rankingTimeMs?: number;
  explainabilityTimeMs?: number;
  singletonRatio?: number;
  hardRejectRatio?: number;
  averageGroupSize?: number;
  averageBestScoreGap?: number;
}

// ═══════════════════════════════════════════════════════════
//  Suspicious Case / Low Confidence / Failure Report
// ═══════════════════════════════════════════════════════════

export interface SuspiciousCase {
  type: string;
  severity: 'info' | 'warning' | 'error';
  description: string;
  affectedIds: string[];
}

export interface LowConfidenceItem {
  fileId: string;
  groupId: string;
  confidence: number;
  reasons: string[];
}

export interface LikelyFailureReason {
  code: string;
  description: string;
  severity: 'info' | 'warning' | 'error';
  evidence: string;
}

export interface ThresholdTuningCandidate {
  metric: string;
  currentThreshold: number;
  suggestedDirection: 'loosen' | 'tighten';
  reason: string;
  affectedCount: number;
  affectedRatio: number;
}

export interface FailureAnalysisReport {
  suspiciousCases: SuspiciousCase[];
  lowConfidenceItems: LowConfidenceItem[];
  metrics: ProcessingMetrics;
  warnings: string[];
  groupSizeDistribution: { size: number; count: number }[];
  scoreDistribution: { range: string; count: number }[];

  // Extended fields for offline evaluation
  totalScenes?: number;
  totalBursts?: number;
  singletonCount?: number;
  hardRejectedCount?: number;
  likelyFailureReasons?: LikelyFailureReason[];
  thresholdTuningCandidates?: ThresholdTuningCandidate[];
}

// ═══════════════════════════════════════════════════════════
//  Confidence computation
// ═══════════════════════════════════════════════════════════

export function computeConfidence(
  score: number,
  groupSize: number,
  scoreGapToNext: number,
  hasFace: boolean,
  rejected: boolean,
): number {
  if (rejected) return 0.9;

  let conf = 0.3;
  conf += Math.min(0.3, scoreGapToNext * 3);
  if (hasFace) conf += 0.15;
  if (score > 0.7) conf += 0.15;
  else if (score > 0.5) conf += 0.05;
  if (groupSize === 1) conf = Math.min(conf, 0.6);

  return Math.min(1, Math.max(0.1, conf));
}

// ═══════════════════════════════════════════════════════════
//  Suspicious case detection
// ═══════════════════════════════════════════════════════════

interface GroupSummary {
  id: string;
  fileIds: string[];
  bestFileId: string | null;
  rejectedCount: number;
  keptCount: number;
}

export function detectSuspiciousCases(
  groups: GroupSummary[],
  totalPhotos: number,
  totalRejected: number,
  scenesCount: number,
): SuspiciousCase[] {
  const cases: SuspiciousCase[] = [];

  for (const g of groups) {
    if (g.keptCount === 0 && g.fileIds.length > 1) {
      cases.push({
        type: 'all_rejected_in_group',
        severity: 'warning',
        description: `그룹 "${g.id}"의 모든 사진(${g.fileIds.length}장)이 탈락됨`,
        affectedIds: g.fileIds,
      });
    }
    if (g.fileIds.length > 20) {
      cases.push({
        type: 'huge_group',
        severity: 'info',
        description: `그룹 "${g.id}"에 ${g.fileIds.length}장 — 더 세분화 가능할 수 있음`,
        affectedIds: [g.id],
      });
    }
  }

  const candidateGroups = groups.filter((g) => g.bestFileId);
  if (candidateGroups.length <= 1 && totalPhotos > 5) {
    cases.push({
      type: 'single_candidate',
      severity: 'warning',
      description: `${totalPhotos}장 중 추천 후보가 ${candidateGroups.length}장뿐`,
      affectedIds: [],
    });
  }

  if (scenesCount === 1 && totalPhotos > 10) {
    cases.push({
      type: 'no_scenes_split',
      severity: 'info',
      description: `${totalPhotos}장이 모두 같은 장면으로 분류됨 — EXIF 시간 정보 부족 가능`,
      affectedIds: [],
    });
  }

  if (totalPhotos > 5 && totalRejected / totalPhotos > 0.8) {
    cases.push({
      type: 'extreme_reject_ratio',
      severity: 'warning',
      description: `전체의 ${Math.round((totalRejected / totalPhotos) * 100)}%가 탈락 — 필터 기준이 과도할 수 있음`,
      affectedIds: [],
    });
  }

  return cases;
}

// ═══════════════════════════════════════════════════════════
//  Distribution helpers
// ═══════════════════════════════════════════════════════════

export function buildScoreDistribution(scores: number[]): { range: string; count: number }[] {
  const ranges = [
    { range: '0.0–0.2', min: 0, max: 0.2 },
    { range: '0.2–0.4', min: 0.2, max: 0.4 },
    { range: '0.4–0.6', min: 0.4, max: 0.6 },
    { range: '0.6–0.8', min: 0.6, max: 0.8 },
    { range: '0.8–1.0', min: 0.8, max: 1.01 },
  ];
  return ranges.map((r) => ({
    range: r.range,
    count: scores.filter((s) => s >= r.min && s < r.max).length,
  }));
}

export function buildGroupSizeDistribution(
  groups: { fileIds: string[] }[],
): { size: number; count: number }[] {
  const sizeMap = new Map<number, number>();
  for (const g of groups) {
    const s = g.fileIds.length;
    sizeMap.set(s, (sizeMap.get(s) ?? 0) + 1);
  }
  return Array.from(sizeMap.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => a.size - b.size);
}

// ═══════════════════════════════════════════════════════════
//  Group relation explanation
// ═══════════════════════════════════════════════════════════

export function explainSameGroup(
  _photoA: PhotoFeatures,
  _photoB: PhotoFeatures,
  evidence: GroupingDecisionEvidence,
): string[] {
  const reasons: string[] = [];
  reasons.push(`같은 장면(${evidence.sceneId})에 속해요`);
  if (evidence.faceCount > 0) {
    reasons.push(`둘 다 인원수 ${evidence.faceCount}명이에요`);
  }
  reasons.push(`프레이밍이 같아요 (${evidence.framingType})`);
  if (evidence.faceCount > 0) {
    reasons.push('얼굴이 같은 사람(들)으로 판별되었어요');
    reasons.push('포즈와 배치가 유사해요');
  }
  return reasons;
}

export function explainDifferentGroup(
  photoA: PhotoFeatures,
  photoB: PhotoFeatures,
  evidenceA: GroupingDecisionEvidence,
  evidenceB: GroupingDecisionEvidence,
): string[] {
  const reasons: string[] = [];

  if (evidenceA.sceneId !== evidenceB.sceneId) {
    reasons.push('다른 장면(시간/장소)에서 촬영되었어요');
    return reasons;
  }

  if (evidenceA.faceCount !== evidenceB.faceCount) {
    reasons.push(
      `인원수가 달라요 (${evidenceA.faceCount}명 vs ${evidenceB.faceCount}명)`,
    );
  }

  if (evidenceA.framingType !== evidenceB.framingType) {
    reasons.push(
      `프레이밍이 달라요 (${evidenceA.framingType} vs ${evidenceB.framingType})`,
    );
  }

  if (reasons.length === 0) {
    const hasFaces = photoA.face.faceCount > 0 && photoB.face.faceCount > 0;
    reasons.push(
      hasFaces
        ? '얼굴이 다른 사람이거나 포즈/배치가 충분히 달라요'
        : '배경/구도가 충분히 달라요',
    );
  }

  return reasons;
}

// ═══════════════════════════════════════════════════════════
//  Recommendation explanation helpers
// ═══════════════════════════════════════════════════════════

export function explainWhyBest(
  breakdown: BestShotScoreBreakdown,
  photoType: PhotoType,
): string[] {
  const reasons: string[] = [];

  if (breakdown.technical.score > 0.7)
    reasons.push('기술적 품질(선명도, 노출)이 우수해요');
  if (breakdown.subject.hasFace && breakdown.subject.score > 0.7)
    reasons.push('피사체(표정, 눈, 얼굴 배치)가 잘 나왔어요');
  if (breakdown.composition.score > 0.7)
    reasons.push('구도가 안정적이에요');
  if (breakdown.context.score > 0.7)
    reasons.push(`${photoType} 타입에 최적화된 사진이에요`);
  if (breakdown.uniqueness.score > 0.8)
    reasons.push('그룹 내에서 독보적인 사진이에요');
  if (breakdown.aesthetics.score > 0.7)
    reasons.push('자연스러운 포즈와 좋은 구도에요');
  if (breakdown.aesthetics.smileQuality > 0.8)
    reasons.push('미소가 자연스러워요');
  if (breakdown.aesthetics.bgSimplicity > 0.7)
    reasons.push('배경이 깔끔해요');

  if (reasons.length === 0) reasons.push('전체적으로 균형 잡힌 사진이에요');
  return reasons;
}

export function explainWhyRejected(rejectReasons: RejectReason[]): string[] {
  return rejectReasons.map(
    (r) =>
      `${r.label} (${r.metric}: ${r.value.toFixed(2)}, 기준: ${r.threshold.toFixed(2)})`,
  );
}

// ═══════════════════════════════════════════════════════════
//  Offline evaluation — failure reason derivation
// ═══════════════════════════════════════════════════════════

export function deriveFailureReasons(
  metrics: ProcessingMetrics,
  scenesCount: number,
  suspiciousCases: SuspiciousCase[],
): LikelyFailureReason[] {
  const reasons: LikelyFailureReason[] = [];
  const total = metrics.totalPhotos;
  if (total === 0) return reasons;

  const rejectRatio = metrics.rejectedCount / total;
  const singletonRatio = metrics.singletonsFound / Math.max(1, metrics.groupsFound);

  // Dominant reject code
  const topReject = Object.entries(metrics.rejectDistribution)
    .sort((a, b) => b[1] - a[1])[0];
  if (topReject && topReject[1] / total > 0.3) {
    reasons.push({
      code: 'dominant_reject',
      description: `"${topReject[0]}" 사유로 전체의 ${Math.round((topReject[1] / total) * 100)}%가 탈락`,
      severity: 'warning',
      evidence: `${topReject[0]}: ${topReject[1]}/${total}`,
    });
  }

  if (rejectRatio > 0.7) {
    reasons.push({
      code: 'extreme_rejection',
      description: `전체의 ${Math.round(rejectRatio * 100)}%가 탈락 — 필터 기준이 과도할 수 있음`,
      severity: 'error',
      evidence: `rejected: ${metrics.rejectedCount}/${total}`,
    });
  }

  if (singletonRatio > 0.6) {
    reasons.push({
      code: 'high_singleton',
      description: `그룹의 ${Math.round(singletonRatio * 100)}%가 싱글톤 — 이미지 간 유사도가 낮거나 그룹 기준이 엄격함`,
      severity: 'warning',
      evidence: `singletons: ${metrics.singletonsFound}/${metrics.groupsFound}`,
    });
  }

  if (scenesCount === 1 && total > 10) {
    reasons.push({
      code: 'no_scene_split',
      description: `${total}장이 모두 같은 장면 — EXIF 시간 정보 부족 가능성`,
      severity: 'info',
      evidence: `scenes: 1, photos: ${total}`,
    });
  }

  if (metrics.candidateCount === 0) {
    reasons.push({
      code: 'no_candidates',
      description: '추천 후보가 0장 — 모든 그룹에서 대표컷 선정 실패',
      severity: 'error',
      evidence: `candidates: 0, groups: ${metrics.groupsFound}`,
    });
  }

  for (const sc of suspiciousCases) {
    if (sc.severity === 'error' || sc.severity === 'warning') {
      reasons.push({
        code: `suspicious_${sc.type}`,
        description: sc.description,
        severity: sc.severity,
        evidence: sc.affectedIds.length > 0 ? `affected: ${sc.affectedIds.length}` : '',
      });
    }
  }

  return reasons;
}

// ═══════════════════════════════════════════════════════════
//  Offline evaluation — threshold tuning candidates
// ═══════════════════════════════════════════════════════════

function getKnownThresholds(): Record<string, { current: number; metric: string }> {
  const hf = getScoringConfig().hardFilters;
  return {
    BLUR_SEVERE: { current: hf.blurSevere, metric: 'blur' },
    FACE_BLUR: { current: hf.faceBlurSevere, metric: 'face_blur' },
    EYE_CLOSED: { current: hf.eyeClosed, metric: 'worst_ear' },
    FACE_CUT: { current: hf.faceCutEnabled ? 1 : 0, metric: 'face_cut' },
    EXPOSURE_EXTREME: { current: hf.exposureExtreme, metric: 'exposure' },
    FACE_TOO_SMALL: { current: hf.faceTooSmall, metric: 'best_face_ratio' },
  };
}

export function deriveThresholdCandidates(
  metrics: ProcessingMetrics,
): ThresholdTuningCandidate[] {
  const total = metrics.totalPhotos;
  if (total === 0) return [];

  const candidates: ThresholdTuningCandidate[] = [];
  const rejectDist = metrics.rejectDistribution;

  for (const [code, info] of Object.entries(getKnownThresholds())) {
    const count = rejectDist[code] ?? 0;
    const ratio = count / total;

    if (ratio > 0.25) {
      candidates.push({
        metric: info.metric,
        currentThreshold: info.current,
        suggestedDirection: 'loosen',
        reason: `"${code}"로 ${Math.round(ratio * 100)}%가 탈락 — 기준 완화 검토 필요`,
        affectedCount: count,
        affectedRatio: ratio,
      });
    }
  }

  // If very few rejections, maybe tighten
  const overallRejectRatio = metrics.rejectedCount / total;
  if (overallRejectRatio < 0.05 && total > 10) {
    candidates.push({
      metric: 'all_filters',
      currentThreshold: 0,
      suggestedDirection: 'tighten',
      reason: `탈락률이 ${Math.round(overallRejectRatio * 100)}%로 매우 낮음 — 품질 기준 강화 검토`,
      affectedCount: metrics.rejectedCount,
      affectedRatio: overallRejectRatio,
    });
  }

  // Group size tuning
  const avgGroupSize = metrics.averageGroupSize ?? (total / Math.max(1, metrics.groupsFound));
  if (avgGroupSize > 15) {
    candidates.push({
      metric: 'scene_similarity_threshold',
      currentThreshold: getGroupingConfig().scene.similarityThreshold,
      suggestedDirection: 'tighten',
      reason: `평균 그룹 크기가 ${avgGroupSize.toFixed(1)}로 큼 — 장면 분리 기준 강화 검토`,
      affectedCount: metrics.groupsFound,
      affectedRatio: avgGroupSize / total,
    });
  }

  return candidates;
}
