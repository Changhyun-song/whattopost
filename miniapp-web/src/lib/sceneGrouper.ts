/**
 * Coarse scene grouping — two strategies:
 *
 * 1. TEMPORAL mode (reliable EXIF timestamps):
 *    Sort by timestamp → sequential walk, split on time gap OR embedding dissimilarity
 *
 * 2. CLUSTERING mode (flat timestamps, e.g. KakaoTalk batch downloads):
 *    Greedy nearest-cluster assignment by embedding similarity alone.
 *    Each photo joins the most similar existing scene, or starts a new one.
 *
 * Auto-detects which mode to use based on timestamp diversity.
 *
 * Config: GroupingConfig.scene (from analysisConfig.ts)
 * Rule tracking: SCENE_BREAK_TIME, SCENE_BREAK_SIM, SCENE_MERGE
 */

import type { PhotoFeatures } from './photoTypes';
import { getGroupingConfig, ruleTracker } from './analysisConfig';

export interface SceneDef {
  id: string;
  photoIds: string[];
  timeMin: number;
  timeMax: number;
  anchorEmbed: Float32Array;
}

const MAX_SCENE_SIZE = 40;
const ANCHOR_BLEND_ALPHA = 0.15;
const ANCHOR_BLEND_CAP = 20;

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function blendEmbed(anchor: Float32Array, incoming: Float32Array, alpha: number): Float32Array {
  const result = new Float32Array(anchor.length);
  let sumSq = 0;
  for (let i = 0; i < anchor.length; i++) {
    const v = anchor[i] * (1 - alpha) + incoming[i] * alpha;
    result[i] = v;
    sumSq += v * v;
  }
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < result.length; i++) result[i] /= norm;
  return result;
}

function hasReliableTimestamps(features: PhotoFeatures[]): boolean {
  if (features.length <= 3) return true;

  const timestamps = features.map((f) => f.timestamp);
  const uniqueTs = new Set(timestamps).size;
  const ratio = uniqueTs / features.length;

  // If <30% of timestamps are unique, they're unreliable (batch download)
  if (ratio < 0.3) {
    console.log(`[scene] flat timestamps detected: ${uniqueTs}/${features.length} unique (${(ratio * 100).toFixed(0)}%) → clustering mode`);
    return false;
  }
  return true;
}

// ── Strategy 1: Temporal sequential walk ──────────────────

function groupByTimestamp(features: PhotoFeatures[]): SceneDef[] {
  const cfg = getGroupingConfig().scene;
  const sorted = [...features].sort((a, b) => a.timestamp - b.timestamp);

  const scenes: SceneDef[] = [];
  let sceneIdx = 0;

  let currentScene: SceneDef = {
    id: `scene_${sceneIdx}`,
    photoIds: [sorted[0].fileId],
    timeMin: sorted[0].timestamp,
    timeMax: sorted[0].timestamp,
    anchorEmbed: sorted[0].sceneEmbed,
  };
  let prevEmbed = sorted[0].sceneEmbed;

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const timeGap = curr.timestamp - sorted[i - 1].timestamp;

    const simToAnchor = cosine(curr.sceneEmbed, currentScene.anchorEmbed);
    const simToPrev = cosine(curr.sceneEmbed, prevEmbed);

    const timeOk = timeGap < cfg.gapMs;
    const simOk = simToAnchor >= cfg.similarityThreshold && simToPrev >= cfg.similarityThreshold;
    const sizeOk = currentScene.photoIds.length < MAX_SCENE_SIZE;

    if (timeOk && simOk && sizeOk) {
      currentScene.photoIds.push(curr.fileId);
      currentScene.timeMax = curr.timestamp;
      if (currentScene.photoIds.length <= ANCHOR_BLEND_CAP) {
        currentScene.anchorEmbed = blendEmbed(currentScene.anchorEmbed, curr.sceneEmbed, ANCHOR_BLEND_ALPHA);
      }
      ruleTracker.fire('SCENE_MERGE');
    } else {
      if (!timeOk) ruleTracker.fire('SCENE_BREAK_TIME');
      if (!simOk) ruleTracker.fire('SCENE_BREAK_SIM');
      if (!sizeOk) ruleTracker.fire('SCENE_BREAK_SIZE');

      scenes.push(currentScene);
      sceneIdx++;
      currentScene = {
        id: `scene_${sceneIdx}`,
        photoIds: [curr.fileId],
        timeMin: curr.timestamp,
        timeMax: curr.timestamp,
        anchorEmbed: curr.sceneEmbed,
      };
    }

    prevEmbed = curr.sceneEmbed;
  }

  scenes.push(currentScene);
  return scenes;
}

// ── Strategy 2: Embedding-only greedy clustering ──────────

function groupByClustering(features: PhotoFeatures[]): SceneDef[] {
  const cfg = getGroupingConfig().scene;
  const threshold = Math.max(cfg.similarityThreshold, 0.65);

  const scenes: SceneDef[] = [];
  let sceneIdx = 0;

  for (const feat of features) {
    let bestSceneIdx = -1;
    let bestSim = -1;

    for (let i = 0; i < scenes.length; i++) {
      if (scenes[i].photoIds.length >= MAX_SCENE_SIZE) continue;
      const sim = cosine(feat.sceneEmbed, scenes[i].anchorEmbed);
      if (sim > bestSim) {
        bestSim = sim;
        bestSceneIdx = i;
      }
    }

    if (bestSceneIdx >= 0 && bestSim >= threshold) {
      const scene = scenes[bestSceneIdx];
      scene.photoIds.push(feat.fileId);
      scene.timeMax = Math.max(scene.timeMax, feat.timestamp);
      if (scene.photoIds.length <= ANCHOR_BLEND_CAP) {
        scene.anchorEmbed = blendEmbed(scene.anchorEmbed, feat.sceneEmbed, 0.10);
      }
      ruleTracker.fire('SCENE_MERGE');
    } else {
      ruleTracker.fire('SCENE_BREAK_SIM');
      scenes.push({
        id: `scene_${sceneIdx++}`,
        photoIds: [feat.fileId],
        timeMin: feat.timestamp,
        timeMax: feat.timestamp,
        anchorEmbed: feat.sceneEmbed,
      });
    }
  }

  console.log(`[scene] clustering produced ${scenes.length} scenes from ${features.length} photos`);
  return scenes;
}

// ── Public API ────────────────────────────────────────────

export function groupByScene(features: PhotoFeatures[]): SceneDef[] {
  if (features.length === 0) return [];

  if (hasReliableTimestamps(features)) {
    return groupByTimestamp(features);
  }
  return groupByClustering(features);
}
