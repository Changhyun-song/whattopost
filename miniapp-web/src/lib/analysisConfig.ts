/**
 * Centralized configuration for all analysis pipeline thresholds,
 * scoring weights, and grouping rules.
 *
 * Every hardcoded value from sceneGrouper / groupSplitter / bestShotRanker
 * is extracted here so that:
 *   1. Threshold tuning requires changing ONE file
 *   2. Each value is documented with purpose and expected range
 *   3. Rule firing is tracked for offline evaluation
 *
 * Usage:
 *   import { getConfig, ruleTracker } from './analysisConfig';
 *   const cfg = getConfig();
 *   ruleTracker.fire('HARD_FILTER_BLUR_SEVERE');
 */

import type { PhotoType } from './photoTypes';

// ═══════════════════════════════════════════════════════════
//  Axis weights (per photo type)
// ═══════════════════════════════════════════════════════════

export interface AxisWeights {
  technical: number;
  subject: number;
  composition: number;
  context: number;
  aesthetics: number;
}

// ═══════════════════════════════════════════════════════════
//  ScoringConfig
// ═══════════════════════════════════════════════════════════

export interface ScoringConfig {
  /** Hard reject filters — photos below these thresholds are eliminated */
  hardFilters: {
    /** Min blur score (0–1). Below → hard reject. Default 0.18 */
    blurSevere: number;
    /** Min worst-eye EAR. Below → hard reject. Default 0.25 */
    eyeClosed: number;
    /** Whether face-cut check is active. Default true */
    faceCutEnabled: boolean;
    /** Min exposure score (0–1). Below → hard reject. Default 0.12 */
    exposureExtreme: number;
    /** Min face-region blur score. Below → hard reject. Default 0.22 */
    faceBlurSevere: number;
    /** Min face size (ratio of image). Below → hard reject. Default 0.02 */
    faceTooSmall: number;
  };

  /** Technical quality axis (sharpness, exposure, composition) */
  technical: {
    /** Weight of sharpness in technical score. Default 0.50 */
    sharpnessWeight: number;
    /** Base weight of exposure in technical score. Default 0.30 */
    exposureBaseWeight: number;
    /** Bonus weight for good exposure. Default 0.10 */
    exposureBonusWeight: number;
    /** Weight of composition in technical score. Default 0.10 */
    compositionWeight: number;
    /** Exposure above this gets bonus. Default 0.85 */
    exposureBonusThreshold: number;
  };

  /** Subject quality axis (eyes, expression, visibility, centering) */
  subject: {
    /** Weight of eye-open metric. Default 0.30 */
    eyeOpenWeight: number;
    /** Weight of expression metric. Default 0.25 */
    expressionWeight: number;
    /** Weight of face visibility. Default 0.20 */
    visibilityWeight: number;
    /** Weight of face centering. Default 0.10 */
    centeringWeight: number;
    /** Weight of face-cut penalty. Default 0.15 */
    faceCutWeight: number;
    /** Face-cut penalty magnitude. Default 0.15 */
    faceCutPenaltyValue: number;
    /** No-face fallback score. Default 0.50 */
    noFaceScore: number;
    /** EAR normalization offset. Default 0.15 */
    earBaseOffset: number;
    /** EAR normalization range. Default 0.20 */
    earRange: number;
    /** Face visibility multiplier. Default 5 */
    visibilityMultiplier: number;
    /** Center distance penalty multiplier. Default 1.5 */
    centerDistMultiplier: number;
  };

  /** Composition axis */
  composition: {
    /** Framing bonus for closeup shots. Default 0.05 */
    closeupBonus: number;
    /** Min face area ratio for closeup bonus. Default 0.08 */
    closeupMinArea: number;
    /** Framing bonus for half-body shots. Default 0.03 */
    halfBodyBonus: number;
  };

  /** Photo-type-specific axis weights */
  typeWeights: Record<PhotoType, AxisWeights>;

  /** Context suitability scoring thresholds */
  context: {
    /** Selfie: min face ratio for high score. Default 0.06 */
    selfieFaceRatioMin: number;
    /** Group photo: min EAR for "all eyes open". Default 0.50 */
    groupAllEyesOpenEAR: number;
    /** Group photo: min face size for "all visible". Default 0.03 */
    groupAllVisibleMinSize: number;
    /** Travel portrait: min composition for high score. Default 0.50 */
    travelCompositionMin: number;
    /** Landscape: min blur for high score. Default 0.60 */
    landscapeBlurMin: number;
    /** Landscape: min composition for high score. Default 0.50 */
    landscapeCompositionMin: number;
  };

  /** Uniqueness penalty for near-duplicates */
  uniqueness: {
    /** Score when photo is in a burst. Default 0.70 */
    burstScore: number;
    /** Similarity above this → heavy penalty. Default 0.95 */
    highSimThreshold: number;
    /** Score at high similarity. Default 0.50 */
    highSimScore: number;
    /** Similarity above this → moderate penalty. Default 0.90 */
    medSimThreshold: number;
    /** Score at moderate similarity. Default 0.70 */
    medSimScore: number;
    /** Score when unique. Default 1.00 */
    defaultScore: number;
  };

  /** Weight for subtractive uniqueness penalty. Default 0.20 (burst penalty: 0.30 * 0.20 = 0.06) */
  uniquenessPenaltyWeight: number;

  /** Group trim: keep top N% of non-rejected photos. Default 0.70 */
  trimKeepRatio: number;

  /** Tag generation thresholds (determines which tags appear on photos) */
  tags: {
    /** EAR above this → "눈 뜸" tag. Default 0.50 */
    eyeOpenEAR: number;
    /** Expression above this → "좋은 표정" tag. Default 0.55 */
    goodExpression: number;
    /** Blur above this → "선명함" tag. Default 0.55 */
    sharpBlur: number;
    /** Composition above this → "구도 안정적" tag. Default 0.60 */
    stableComposition: number;
    /** Exposure above this → "밝기 좋음" tag. Default 0.60 */
    goodExposure: number;
    /** Subject score above this → "얼굴 잘 보임" tag. Default 0.60 */
    faceVisibleSubjectScore: number;
    /** Total above this → "프사 후보" tag. Default 0.70 */
    profileCandidateTotal: number;
  };

  /** Confidence calculation parameters */
  confidence: {
    /** Base confidence. Default 0.30 */
    base: number;
    /** Score gap multiplier. Default 3.0 */
    scoreGapMultiplier: number;
    /** Max bonus from score gap. Default 0.30 */
    maxGapBonus: number;
    /** Bonus for having faces. Default 0.15 */
    faceBonus: number;
    /** High score threshold for bonus. Default 0.70 */
    highScoreThreshold: number;
    /** Bonus at high score. Default 0.15 */
    highScoreBonus: number;
    /** Medium score threshold for bonus. Default 0.50 */
    medScoreThreshold: number;
    /** Bonus at medium score. Default 0.05 */
    medScoreBonus: number;
    /** Max confidence for singleton groups. Default 0.60 */
    singletonCap: number;
    /** Confidence for rejected photos. Default 0.90 */
    rejectedConfidence: number;
  };

  /** Score cap for hard-rejected photos. Default 0.25 */
  rejectedScoreCap: number;

  /** Reason generation: score above this → top-tier reason. Default 0.85 */
  topTierScoreThreshold: number;
}

// ═══════════════════════════════════════════════════════════
//  GroupingConfig
// ═══════════════════════════════════════════════════════════

export interface GroupingConfig {
  /** Coarse scene grouping */
  scene: {
    /** Max time gap (ms) before splitting into a new scene. Default 300000 (5 min) */
    gapMs: number;
    /** Min cosine similarity to stay in the same scene. Default 0.85 (RGB embedding is more discriminative) */
    similarityThreshold: number;
  };

  /** Fine group splitting rules */
  splitting: {
    /** Enable hard split by face count. Default true */
    personCountHardSplit: boolean;
    /** Enable hard split by framing type. Default true */
    framingHardSplit: boolean;
    /** Max Euclidean distance for same identity. Default 0.75 */
    identityThreshold: number;
    /** Min cosine similarity for same layout/pose. Default 0.60 (includes RGB scene embed component) */
    layoutSimThreshold: number;
  };

  /** Burst detection */
  burst: {
    /** Max time gap (ms) for burst. Default 2000 */
    timeThresholdMs: number;
    /** Min scene similarity for burst. Default 0.95 (RGB embedding — burst photos are nearly identical) */
    sceneSimThreshold: number;
  };
}

// ═══════════════════════════════════════════════════════════
//  Defaults
// ═══════════════════════════════════════════════════════════

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  hardFilters: {
    blurSevere: 0.25,
    eyeClosed: 0.55,
    faceCutEnabled: true,
    exposureExtreme: 0.15,
    faceBlurSevere: 0.28,
    faceTooSmall: 0.02,
  },

  technical: {
    sharpnessWeight: 0.50,
    exposureBaseWeight: 0.30,
    exposureBonusWeight: 0.10,
    compositionWeight: 0.10,
    exposureBonusThreshold: 0.85,
  },

  subject: {
    eyeOpenWeight: 0.35,
    expressionWeight: 0.20,
    visibilityWeight: 0.20,
    centeringWeight: 0.10,
    faceCutWeight: 0.15,
    faceCutPenaltyValue: 0.15,
    noFaceScore: 0.50,
    earBaseOffset: 0.0,
    earRange: 0.70,
    visibilityMultiplier: 5,
    centerDistMultiplier: 1.5,
  },

  composition: {
    closeupBonus: 0.05,
    closeupMinArea: 0.08,
    halfBodyBonus: 0.03,
  },

  typeWeights: {
    selfie:          { technical: 0.15, subject: 0.35, composition: 0.10, context: 0.15, aesthetics: 0.25 },
    portrait:        { technical: 0.20, subject: 0.30, composition: 0.15, context: 0.15, aesthetics: 0.20 },
    group_photo:     { technical: 0.15, subject: 0.40, composition: 0.10, context: 0.20, aesthetics: 0.15 },
    travel_portrait: { technical: 0.20, subject: 0.20, composition: 0.20, context: 0.15, aesthetics: 0.25 },
    landscape:       { technical: 0.35, subject: 0.05, composition: 0.40, context: 0.15, aesthetics: 0.05 },
  },

  context: {
    selfieFaceRatioMin: 0.06,
    groupAllEyesOpenEAR: 0.50,
    groupAllVisibleMinSize: 0.03,
    travelCompositionMin: 0.50,
    landscapeBlurMin: 0.60,
    landscapeCompositionMin: 0.50,
  },

  uniqueness: {
    burstScore: 0.70,
    highSimThreshold: 0.95,
    highSimScore: 0.50,
    medSimThreshold: 0.90,
    medSimScore: 0.70,
    defaultScore: 1.0,
  },

  uniquenessPenaltyWeight: 0.20,

  trimKeepRatio: 0.70,

  tags: {
    eyeOpenEAR: 0.50,
    goodExpression: 0.55,
    sharpBlur: 0.55,
    stableComposition: 0.60,
    goodExposure: 0.60,
    faceVisibleSubjectScore: 0.60,
    profileCandidateTotal: 0.70,
  },

  confidence: {
    base: 0.30,
    scoreGapMultiplier: 3.0,
    maxGapBonus: 0.30,
    faceBonus: 0.15,
    highScoreThreshold: 0.70,
    highScoreBonus: 0.15,
    medScoreThreshold: 0.50,
    medScoreBonus: 0.05,
    singletonCap: 0.60,
    rejectedConfidence: 0.90,
  },

  rejectedScoreCap: 0.25,
  topTierScoreThreshold: 0.85,
};

export const DEFAULT_GROUPING_CONFIG: GroupingConfig = {
  scene: {
    gapMs: 3 * 60 * 1000,
    similarityThreshold: 0.60,
  },

  splitting: {
    personCountHardSplit: true,
    framingHardSplit: true,
    identityThreshold: 0.75,
    layoutSimThreshold: 0.60,
  },

  burst: {
    timeThresholdMs: 2000,
    sceneSimThreshold: 0.82,
  },
};

// ═══════════════════════════════════════════════════════════
//  Runtime config (mutable singleton)
// ═══════════════════════════════════════════════════════════

let scoringConfig: ScoringConfig = structuredClone(DEFAULT_SCORING_CONFIG);
let groupingConfig: GroupingConfig = structuredClone(DEFAULT_GROUPING_CONFIG);

export function getScoringConfig(): Readonly<ScoringConfig> { return scoringConfig; }
export function getGroupingConfig(): Readonly<GroupingConfig> { return groupingConfig; }

export function updateScoringConfig(patch: Partial<ScoringConfig>): void {
  scoringConfig = { ...scoringConfig, ...patch };
}

export function updateGroupingConfig(patch: Partial<GroupingConfig>): void {
  groupingConfig = { ...groupingConfig, ...patch };
}

export function resetConfig(): void {
  scoringConfig = structuredClone(DEFAULT_SCORING_CONFIG);
  groupingConfig = structuredClone(DEFAULT_GROUPING_CONFIG);
}

// ═══════════════════════════════════════════════════════════
//  Rule firing tracker
// ═══════════════════════════════════════════════════════════

export interface RuleFiringRecord {
  rule: string;
  displayName: string;
  count: number;
}

const RULE_NAMES: Record<string, string> = {
  // Hard filters
  'HARD_BLUR_SEVERE':     '심한 블러 필터',
  'HARD_FACE_BLUR':       '얼굴 블러 필터',
  'HARD_EYE_CLOSED':      '눈 감음 필터',
  'HARD_FACE_CUT':        '얼굴 잘림 필터',
  'HARD_EXPOSURE_EXTREME': '극단 노출 필터',
  'HARD_FACE_TOO_SMALL':  '얼굴 너무 작음 필터',
  'SOFT_GROUP_TRIM':      '그룹 내 하위 트림',
  // Grouping
  'SCENE_BREAK_TIME':     '시간 간격 장면 분리',
  'SCENE_BREAK_SIM':      '유사도 장면 분리',
  'SCENE_BREAK_SIZE':     '장면 크기 초과 분리',
  'SCENE_MERGE':          '장면 병합 (동일 장면 유지)',
  'SPLIT_FACE_COUNT':     '인원수 기반 그룹 분리',
  'SPLIT_FRAMING':        '프레이밍 기반 그룹 분리',
  'SPLIT_IDENTITY':       '얼굴 신원 기반 그룹 분리',
  'SPLIT_LAYOUT':         '포즈/배치 기반 그룹 분리',
  'SPLIT_BACKGROUND':     '배경/장소 기반 그룹 분리',
  'SINGLETON_MERGED':     '싱글톤 → 가까운 그룹 흡수',
  'BURST_DETECTED':       '연사 묶음 감지',
  // Scoring
  'TYPE_SELFIE':          '셀카 가중치 적용',
  'TYPE_PORTRAIT':        '인물 가중치 적용',
  'TYPE_GROUP_PHOTO':     '단체사진 가중치 적용',
  'TYPE_TRAVEL_PORTRAIT': '여행 인물 가중치 적용',
  'TYPE_LANDSCAPE':       '풍경 가중치 적용',
  'UNIQUENESS_BURST':     '연사 유니크니스 패널티',
  'UNIQUENESS_HIGH_SIM':  '높은 유사도 패널티',
  'UNIQUENESS_MED_SIM':   '중간 유사도 패널티',
};

class RuleFiringTracker {
  private counts = new Map<string, number>();

  fire(rule: string, increment = 1): void {
    this.counts.set(rule, (this.counts.get(rule) ?? 0) + increment);
  }

  getCount(rule: string): number {
    return this.counts.get(rule) ?? 0;
  }

  getAll(): RuleFiringRecord[] {
    const records: RuleFiringRecord[] = [];
    for (const [rule, count] of this.counts.entries()) {
      records.push({
        rule,
        displayName: RULE_NAMES[rule] ?? rule,
        count,
      });
    }
    records.sort((a, b) => b.count - a.count);
    return records;
  }

  getAllCounts(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  reset(): void {
    this.counts.clear();
  }
}

export const ruleTracker = new RuleFiringTracker();

// ═══════════════════════════════════════════════════════════
//  Config snapshot for export
// ═══════════════════════════════════════════════════════════

export function exportConfigSnapshot(): {
  scoring: ScoringConfig;
  grouping: GroupingConfig;
  ruleFirings: RuleFiringRecord[];
} {
  return {
    scoring: structuredClone(scoringConfig),
    grouping: structuredClone(groupingConfig),
    ruleFirings: ruleTracker.getAll(),
  };
}
