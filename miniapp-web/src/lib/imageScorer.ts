/**
 * Image scorer — compatibility shim.
 *
 * The actual scoring is now in bestShotRanker.ts.
 * This file exports getStrengthTags() and generateReason()
 * which GroupDetail.tsx still imports.
 */

import type { QualityScores } from './mockAnalysis';

export type { QualityScores };

// ─── Strength tags ───────────────────────────────────────

const TAG_DEFS: { key: keyof QualityScores; floor: number; label: string; faceDep: boolean }[] = [
  { key: 'eyeOpen',        floor: 0.60, label: '눈 뜸',         faceDep: true },
  { key: 'expression',     floor: 0.55, label: '좋은 표정',     faceDep: true },
  { key: 'sharpness',      floor: 0.55, label: '선명함',        faceDep: false },
  { key: 'composition',    floor: 0.60, label: '구도 안정적',    faceDep: false },
  { key: 'exposure',       floor: 0.60, label: '밝기 좋음',      faceDep: false },
  { key: 'faceVisibility', floor: 0.55, label: '얼굴 잘 보임',   faceDep: true },
];

export function getStrengthTags(scores: QualityScores): string[] {
  const hasFace = scores.faceCount > 0;
  return TAG_DEFS
    .filter((d) => {
      if (d.faceDep && !hasFace) return false;
      return scores[d.key] >= d.floor;
    })
    .map((d) => d.label);
}
