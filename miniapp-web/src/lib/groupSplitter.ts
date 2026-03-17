/**
 * Fine group splitting within a scene + burst detection.
 *
 * Splitting cascade (each step splits further):
 *   1. face count     — hard split (0 vs 1 vs 2 vs 3+)
 *   2. framing type   — hard split (closeup vs half vs full vs wide)
 *   3. face identity  — split if different people (descriptor Euclidean > threshold)
 *   4. face layout    — split if pose/arrangement differs significantly
 *
 * After splitting, detect bursts (very short time gap + high scene similarity).
 *
 * Config: GroupingConfig.splitting + GroupingConfig.burst (from analysisConfig.ts)
 * Rule tracking: SPLIT_FACE_COUNT, SPLIT_FRAMING, SPLIT_IDENTITY, SPLIT_LAYOUT, BURST_DETECTED
 */

import type { PhotoFeatures } from './photoTypes';
import type { SceneDef } from './sceneGrouper';
import type {
  GroupingDecisionEvidence,
  SplitRuleApplication,
} from './explainability';
import { getGroupingConfig, ruleTracker } from './analysisConfig';

// ─── Types ───────────────────────────────────────────────

export interface GroupDef {
  id: string;
  sceneId: string;
  photoIds: string[];
  faceCount: number;
  label: string;
  isSingleton: boolean;
  burstGroups: string[][];
  evidence: GroupingDecisionEvidence;
}

// ─── Utilities ───────────────────────────────────────────

const DESC_DIM = 128;

function faceIdentityDistance(a: PhotoFeatures, b: PhotoFeatures): number {
  const fA = [...a.face.faces].sort((x, y) => x.cx - y.cx);
  const fB = [...b.face.faces].sort((x, y) => x.cx - y.cx);
  const n = Math.min(fA.length, fB.length, 5);
  if (n === 0) return 0;

  let maxDist = 0;
  for (let i = 0; i < n; i++) {
    const dA = fA[i].descriptor;
    const dB = fB[i].descriptor;
    if (!dA || !dB || dA.length !== DESC_DIM || dB.length !== DESC_DIM) return 999;
    let sum = 0;
    for (let j = 0; j < DESC_DIM; j++) {
      const d = dA[j] - dB[j];
      sum += d * d;
    }
    maxDist = Math.max(maxDist, Math.sqrt(sum));
  }
  return maxDist;
}

function faceLayoutSimilarity(a: PhotoFeatures, b: PhotoFeatures): number {
  const fA = [...a.face.faces].sort((x, y) => x.cx - y.cx);
  const fB = [...b.face.faces].sort((x, y) => x.cx - y.cx);
  const n = Math.min(fA.length, fB.length, 5);
  if (n === 0) return 1;

  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const va = [fA[i].cx, fA[i].cy, fA[i].size];
    const vb = [fB[i].cx, fB[i].cy, fB[i].size];
    for (let j = 0; j < 3; j++) {
      dot += va[j] * vb[j];
      na += va[j] * va[j];
      nb += vb[j] * vb[j];
    }
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  const faceSim = denom > 0 ? dot / denom : 0;

  const sceneSimilarity = sceneSim(a, b);

  // 60% face layout + 40% scene embedding — face position is more stable than pixel-level scene diff
  return faceSim * 0.6 + sceneSimilarity * 0.4;
}

function sceneSim(a: PhotoFeatures, b: PhotoFeatures): number {
  let dot = 0;
  for (let i = 0; i < a.sceneEmbed.length; i++) dot += a.sceneEmbed[i] * b.sceneEmbed[i];
  return dot;
}

// ─── Splitting logic ─────────────────────────────────────

type Bucket = string[];

function splitByPredicate(
  buckets: Bucket[],
  featureMap: Map<string, PhotoFeatures>,
  keyFn: (f: PhotoFeatures) => string,
): Bucket[] {
  const result: Bucket[] = [];
  for (const bucket of buckets) {
    const sub = new Map<string, string[]>();
    for (const id of bucket) {
      const f = featureMap.get(id)!;
      const key = keyFn(f);
      if (!sub.has(key)) sub.set(key, []);
      sub.get(key)!.push(id);
    }
    result.push(...sub.values());
  }
  return result;
}

function splitByIdentity(
  buckets: Bucket[],
  featureMap: Map<string, PhotoFeatures>,
  threshold: number,
): Bucket[] {
  const result: Bucket[] = [];

  for (const bucket of buckets) {
    if (bucket.length <= 1) { result.push(bucket); continue; }

    const features = bucket.map((id) => featureMap.get(id)!);
    const subGroups: Bucket[] = [[bucket[0]]];

    for (let i = 1; i < bucket.length; i++) {
      let placed = false;
      for (const sg of subGroups) {
        // Check against ALL members — join if close to ANY member
        let minDist = Infinity;
        for (const memberId of sg) {
          const dist = faceIdentityDistance(features[i], featureMap.get(memberId)!);
          if (dist < minDist) minDist = dist;
        }
        if (minDist <= threshold) {
          sg.push(bucket[i]);
          placed = true;
          break;
        }
      }
      if (!placed) {
        subGroups.push([bucket[i]]);
        ruleTracker.fire('SPLIT_IDENTITY');
      }
    }
    result.push(...subGroups);
  }
  return result;
}

function splitByLayout(
  buckets: Bucket[],
  featureMap: Map<string, PhotoFeatures>,
  threshold: number,
): Bucket[] {
  const result: Bucket[] = [];

  for (const bucket of buckets) {
    if (bucket.length <= 1) { result.push(bucket); continue; }

    const subGroups: Bucket[] = [[bucket[0]]];

    for (let i = 1; i < bucket.length; i++) {
      const curr = featureMap.get(bucket[i])!;
      let placed = false;
      for (const sg of subGroups) {
        // Check against ALL members — join if similar to ANY member
        let maxSim = -1;
        for (const memberId of sg) {
          const sim = faceLayoutSimilarity(curr, featureMap.get(memberId)!);
          if (sim > maxSim) maxSim = sim;
        }
        if (maxSim >= threshold) {
          sg.push(bucket[i]);
          placed = true;
          break;
        }
      }
      if (!placed) {
        subGroups.push([bucket[i]]);
        ruleTracker.fire('SPLIT_LAYOUT');
      }
    }
    result.push(...subGroups);
  }
  return result;
}

// ─── Background/scene split ──────────────────────────────

function splitByBackground(
  buckets: Bucket[],
  featureMap: Map<string, PhotoFeatures>,
  threshold: number,
): Bucket[] {
  const result: Bucket[] = [];

  for (const bucket of buckets) {
    if (bucket.length <= 1) { result.push(bucket); continue; }

    const subGroups: Bucket[] = [[bucket[0]]];

    for (let i = 1; i < bucket.length; i++) {
      const curr = featureMap.get(bucket[i])!;
      let placed = false;
      for (const sg of subGroups) {
        let maxSim = -1;
        for (const memberId of sg) {
          const sim = sceneSim(curr, featureMap.get(memberId)!);
          if (sim > maxSim) maxSim = sim;
        }
        if (maxSim >= threshold) {
          sg.push(bucket[i]);
          placed = true;
          break;
        }
      }
      if (!placed) {
        subGroups.push([bucket[i]]);
        ruleTracker.fire('SPLIT_BACKGROUND');
      }
    }
    result.push(...subGroups);
  }
  return result;
}

// ─── Burst detection ─────────────────────────────────────

function detectBursts(
  photoIds: string[],
  featureMap: Map<string, PhotoFeatures>,
): string[][] {
  if (photoIds.length <= 1) return [photoIds];

  const cfg = getGroupingConfig().burst;
  const sorted = [...photoIds].sort(
    (a, b) => featureMap.get(a)!.timestamp - featureMap.get(b)!.timestamp,
  );

  const bursts: string[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = featureMap.get(sorted[i - 1])!;
    const curr = featureMap.get(sorted[i])!;
    const timeDiff = curr.timestamp - prev.timestamp;
    const sim = sceneSim(prev, curr);

    if (timeDiff <= cfg.timeThresholdMs && sim >= cfg.sceneSimThreshold) {
      bursts[bursts.length - 1].push(sorted[i]);
    } else {
      bursts.push([sorted[i]]);
    }
  }

  const burstCount = bursts.filter((b) => b.length > 1).length;
  if (burstCount > 0) ruleTracker.fire('BURST_DETECTED', burstCount);

  return bursts;
}

// ─── Label generation ────────────────────────────────────

function makeLabel(faceCount: number, framingType: string, idx: number, total: number): string {
  const suffix = total > 1 ? ` ${String.fromCharCode(65 + Math.min(idx, 25))}` : '';

  if (faceCount === 0) return `풍경/사물${suffix}`;

  const framingLabel: Record<string, string> = {
    closeup: '클로즈업',
    half_body: '상반신',
    full_body: '전신',
    wide: '와이드',
  };

  const framing = framingLabel[framingType] || '';

  if (faceCount === 1) return `셀카/인물 ${framing}${suffix}`.trim();
  return `${faceCount}명 ${framing}${suffix}`.trim();
}

// ─── Public API ──────────────────────────────────────────

export function splitSceneIntoGroups(
  scene: SceneDef,
  featureMap: Map<string, PhotoFeatures>,
  globalGroupIdx: { value: number },
): GroupDef[] {
  const cfg = getGroupingConfig().splitting;
  let buckets: Bucket[] = [scene.photoIds];
  const cascadeLog: SplitRuleApplication[] = [];

  // 1. Split by face count
  if (cfg.personCountHardSplit) {
    const before = buckets.length;
    buckets = splitByPredicate(buckets, featureMap, (f) => String(f.face.faceCount));
    const splits = buckets.length - before;
    if (splits > 0) ruleTracker.fire('SPLIT_FACE_COUNT', splits);
  }
  cascadeLog.push({
    rule: 'face_count',
    description: '인원수(face_count) 기반 hard split',
    threshold: 'exact match',
    bucketsAfter: buckets.length,
  });

  // 2. Split by framing type
  if (cfg.framingHardSplit) {
    const before = buckets.length;
    buckets = splitByPredicate(buckets, featureMap, (f) => f.framingType);
    const splits = buckets.length - before;
    if (splits > 0) ruleTracker.fire('SPLIT_FRAMING', splits);
  }
  cascadeLog.push({
    rule: 'framing',
    description: '프레이밍(closeup/half/full/wide) 기반 split',
    threshold: 'exact match',
    bucketsAfter: buckets.length,
  });

  // 3. Split by face identity (only for face-containing photos)
  const withFaces: Bucket[] = [];
  const noFaces: Bucket[] = [];
  for (const b of buckets) {
    const sample = featureMap.get(b[0])!;
    if (sample.face.faceCount > 0) withFaces.push(b);
    else noFaces.push(b);
  }
  const identitySplit = splitByIdentity(withFaces, featureMap, cfg.identityThreshold);
  cascadeLog.push({
    rule: 'identity',
    description: `얼굴 신원 기반 split (Euclidean ≤ ${cfg.identityThreshold})`,
    threshold: cfg.identityThreshold,
    bucketsAfter: identitySplit.length + noFaces.length,
  });

  // 4. Split by layout/pose
  const layoutSplit = splitByLayout(identitySplit, featureMap, cfg.layoutSimThreshold);
  cascadeLog.push({
    rule: 'layout',
    description: `포즈/배치 유사도 기반 split (cosine ≥ ${cfg.layoutSimThreshold})`,
    threshold: cfg.layoutSimThreshold,
    bucketsAfter: layoutSplit.length + noFaces.length,
  });

  // 5. Split by background/scene — catches different locations with similar face layout
  const BACKGROUND_SIM_THRESHOLD = 0.55;
  const bgSplit = splitByBackground([...layoutSplit, ...noFaces], featureMap, BACKGROUND_SIM_THRESHOLD);
  cascadeLog.push({
    rule: 'background',
    description: `배경 유사도 기반 split (scene cosine ≥ ${BACKGROUND_SIM_THRESHOLD})`,
    threshold: BACKGROUND_SIM_THRESHOLD,
    bucketsAfter: bgSplit.length,
  });

  // ─── Singleton merge-back ────────────────────────────────
  // Singletons that share faceCount+framing with a multi-photo group
  // get absorbed into the nearest matching group — BUT only if the
  // background (scene embedding) is also similar enough.
  const SINGLETON_MERGE_MIN_LAYOUT = 0.35;
  const SINGLETON_MERGE_MIN_SCENE = 0.50;
  const merged = [...bgSplit];

  const singletons: number[] = [];
  const multiGroups: number[] = [];
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].length === 1) singletons.push(i);
    else multiGroups.push(i);
  }

  const absorbed = new Set<number>();
  for (const sIdx of singletons) {
    const sId = merged[sIdx][0];
    const sF = featureMap.get(sId)!;
    const sKey = `${sF.face.faceCount}_${sF.framingType}`;

    let bestGroupIdx = -1;
    let bestScore = -1;
    for (const gIdx of multiGroups) {
      const gSample = featureMap.get(merged[gIdx][0])!;
      const gKey = `${gSample.face.faceCount}_${gSample.framingType}`;
      if (gKey !== sKey) continue;

      let maxLayout = -1;
      let maxScene = -1;
      for (const memberId of merged[gIdx]) {
        const member = featureMap.get(memberId)!;
        const ls = faceLayoutSimilarity(sF, member);
        const ss = sceneSim(sF, member);
        if (ls > maxLayout) maxLayout = ls;
        if (ss > maxScene) maxScene = ss;
      }

      // Must pass BOTH layout AND scene similarity
      if (maxLayout >= SINGLETON_MERGE_MIN_LAYOUT && maxScene >= SINGLETON_MERGE_MIN_SCENE) {
        const combined = maxLayout * 0.4 + maxScene * 0.6;
        if (combined > bestScore) {
          bestScore = combined;
          bestGroupIdx = gIdx;
        }
      }
    }

    if (bestGroupIdx >= 0) {
      merged[bestGroupIdx].push(sId);
      absorbed.add(sIdx);
      ruleTracker.fire('SINGLETON_MERGED');
    }
  }

  const allBuckets = merged.filter((_, i) => !absorbed.has(i));

  const labelCounter = new Map<string, number>();
  const groups: { bucket: Bucket; rawLabel: string }[] = [];

  for (const bucket of allBuckets) {
    const sample = featureMap.get(bucket[0])!;
    const raw = `${sample.face.faceCount}_${sample.framingType}`;
    labelCounter.set(raw, (labelCounter.get(raw) ?? 0) + 1);
    groups.push({ bucket, rawLabel: raw });
  }

  const labelIdx = new Map<string, number>();

  return groups.map(({ bucket, rawLabel }) => {
    const idx = labelIdx.get(rawLabel) ?? 0;
    labelIdx.set(rawLabel, idx + 1);
    const total = labelCounter.get(rawLabel) ?? 1;
    const sample = featureMap.get(bucket[0])!;
    const gid = globalGroupIdx.value++;
    const groupId = `g_${gid}`;
    const burstGroups = detectBursts(bucket, featureMap);

    const evidence: GroupingDecisionEvidence = {
      groupId,
      sceneId: scene.id,
      appliedRules: cascadeLog,
      memberCount: bucket.length,
      faceCount: sample.face.faceCount,
      framingType: sample.framingType,
      burstSubgroups: burstGroups.filter((b) => b.length > 1).length,
      isSingleton: bucket.length === 1,
    };

    return {
      id: groupId,
      sceneId: scene.id,
      photoIds: bucket,
      faceCount: sample.face.faceCount,
      label: makeLabel(sample.face.faceCount, sample.framingType, idx, total),
      isSingleton: bucket.length === 1,
      burstGroups,
      evidence,
    };
  });
}
