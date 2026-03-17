/**
 * Offline evaluation export — produces 4 separate JSON files
 * designed for threshold tuning and failure analysis.
 *
 * Files:
 *   upload_<id>_groups.json    — predicted group structure
 *   upload_<id>_scores.json    — per-photo score breakdowns
 *   upload_<id>_failures.json  — failure analysis + threshold candidates
 *   upload_<id>_summary.json   — high-level metrics + pipeline stats
 */

import type { AnalysisResult } from './mockAnalysis';
import type {
  LikelyFailureReason,
  ThresholdTuningCandidate,
} from './explainability';
import { exportConfigSnapshot } from './analysisConfig';

// ─── Helpers ─────────────────────────────────────────────

function round(n: number, d = 4): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function safeRatio(num: number, den: number): number {
  return den > 0 ? round(num / den) : 0;
}

function getUploadId(result: AnalysisResult): string {
  return (result as AnalysisResult & { uploadId?: string }).uploadId
    ?? `u_${Date.now()}`;
}

function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
//  1. Groups export
// ═══════════════════════════════════════════════════════════

export function buildGroupsExport(result: AnalysisResult) {
  const uploadId = getUploadId(result);
  const evidence = result.groupEvidence ?? [];
  const evidenceMap = new Map(evidence.map((e) => [e.groupId, e]));

  return {
    uploadId,
    exportedAt: new Date().toISOString(),
    version: 'v1',
    totalScenes: result.metrics?.scenesFound ?? 0,
    totalGroups: result.groupCount,

    groups: result.groups.map((g) => {
      const ev = evidenceMap.get(g.id);
      return {
        id: g.id,
        sceneId: ev?.sceneId ?? null,
        label: g.label,
        photoCount: g.fileIds.length,
        bestFileId: g.bestFileId,
        keptCount: g.keptCount,
        rejectedCount: g.rejectedCount,
        isSingleton: ev?.isSingleton ?? g.fileIds.length === 1,
        faceCount: ev?.faceCount ?? null,
        framingType: ev?.framingType ?? null,
        burstSubgroups: ev?.burstSubgroups ?? 0,
        members: g.fileIds,
        splitEvidence: ev?.appliedRules.map((r) => ({
          rule: r.rule,
          description: r.description,
          threshold: r.threshold,
          bucketsAfter: r.bucketsAfter,
        })) ?? [],
      };
    }),
  };
}

// ═══════════════════════════════════════════════════════════
//  2. Scores export
// ═══════════════════════════════════════════════════════════

export function buildScoresExport(result: AnalysisResult) {
  const uploadId = getUploadId(result);
  const explanationMap = new Map(
    (result.explanations ?? []).map((e) => [e.fileId, e]),
  );

  // Find groupId for each photo
  const photoGroupMap = new Map<string, string>();
  for (const g of result.groups) {
    for (const fid of g.fileIds) photoGroupMap.set(fid, g.id);
  }

  return {
    uploadId,
    exportedAt: new Date().toISOString(),
    version: 'v1',
    totalPhotos: result.totalCount,

    photos: result.allRanked.map((rp) => {
      const ex = explanationMap.get(rp.fileId);
      const bd = ex?.scoreBreakdown;

      return {
        fileId: rp.fileId,
        groupId: photoGroupMap.get(rp.fileId) ?? null,
        rank: ex?.rank ?? null,
        score: round(rp.score),
        rejected: rp.rejected,
        rejectReason: rp.rejectReason,
        rejectReasons: ex?.rejectReasons.map((r) => ({
          code: r.code,
          label: r.label,
          severity: r.severity,
          metric: r.metric,
          value: round(r.value),
          threshold: round(r.threshold),
        })) ?? [],
        confidence: ex ? round(ex.confidence) : null,
        tags: rp.tags,
        reason: rp.reason,
        scoreBreakdown: bd ? {
          total: round(bd.total),
          technical: { score: round(bd.technical.score), sharpness: round(bd.technical.sharpness), exposure: round(bd.technical.exposure) },
          subject: { score: round(bd.subject.score), eyeOpen: round(bd.subject.eyeOpenNorm), expression: round(bd.subject.expressionNorm), visibility: round(bd.subject.visibilityNorm), faceCut: round(bd.subject.faceCutPenalty) },
          composition: { score: round(bd.composition.score), framing: bd.composition.framingType },
          context: { score: round(bd.context.score), photoType: bd.context.photoType },
          uniqueness: { score: round(bd.uniqueness.score), inBurst: bd.uniqueness.inBurst },
          weights: bd.appliedWeights,
        } : null,
        qualityScores: {
          sharpness: round(rp.qualityScores.sharpness),
          exposure: round(rp.qualityScores.exposure),
          facePresence: round(rp.qualityScores.facePresence),
          eyeOpen: round(rp.qualityScores.eyeOpen),
          faceVisibility: round(rp.qualityScores.faceVisibility),
          composition: round(rp.qualityScores.composition),
          expression: round(rp.qualityScores.expression),
          faceCount: rp.qualityScores.faceCount,
        },
      };
    }),

    candidates: result.candidates.map((c) => ({
      fileId: c.fileId,
      score: round(c.score),
      category: c.category,
      tag: c.tag,
      reason: c.reason,
    })),

    representativePicks: result.groups
      .filter((g) => g.bestFileId)
      .map((g) => {
        const best = g.ranked.find((r) => r.fileId === g.bestFileId);
        const ex = explanationMap.get(g.bestFileId!);
        return {
          groupId: g.id,
          groupLabel: g.label,
          fileId: g.bestFileId,
          score: best ? round(best.score) : null,
          confidence: ex ? round(ex.confidence) : null,
          whySelected: ex?.whySelected ?? [],
          comparedTo: ex?.comparedTo.map((c) => ({
            fileId: c.fileId,
            scoreDiff: round(c.scoreDiff),
            mainAdvantage: c.mainAdvantage,
          })) ?? [],
        };
      }),
  };
}

// ═══════════════════════════════════════════════════════════
//  3. Failures export
// ═══════════════════════════════════════════════════════════

export function buildFailuresExport(result: AnalysisResult) {
  const uploadId = getUploadId(result);
  const m = result.metrics;
  const fr = result.failureReport;

  return {
    uploadId,
    exportedAt: new Date().toISOString(),
    version: 'v1',

    totalPhotos: result.totalCount,
    totalScenes: fr?.totalScenes ?? m?.scenesFound ?? 0,
    totalGroups: result.groupCount,
    totalBursts: fr?.totalBursts ?? m?.burstsDetected ?? 0,
    singletonCount: fr?.singletonCount ?? m?.singletonsFound ?? 0,
    hardRejectedCount: fr?.hardRejectedCount ?? m?.rejectedCount ?? 0,

    lowConfidencePicks: (fr?.lowConfidenceItems ?? []).map((lc) => ({
      fileId: lc.fileId,
      groupId: lc.groupId,
      confidence: round(lc.confidence),
      reasons: lc.reasons,
    })),

    suspiciousCases: (fr?.suspiciousCases ?? []).map((sc) => ({
      type: sc.type,
      severity: sc.severity,
      description: sc.description,
      affectedIds: sc.affectedIds,
    })),

    likelyFailureReasons: (fr?.likelyFailureReasons ?? []).map((r) => ({
      code: r.code,
      description: r.description,
      severity: r.severity,
      evidence: r.evidence,
    })),

    thresholdTuningCandidates: (fr?.thresholdTuningCandidates ?? []).map((t) => ({
      metric: t.metric,
      currentThreshold: t.currentThreshold,
      suggestedDirection: t.suggestedDirection,
      reason: t.reason,
      affectedCount: t.affectedCount,
      affectedRatio: round(t.affectedRatio),
    })),

    rejectDistribution: m?.rejectDistribution ?? {},

    scoreDistribution: fr?.scoreDistribution ?? [],
    groupSizeDistribution: fr?.groupSizeDistribution ?? [],
    warnings: fr?.warnings ?? [],
  };
}

// ═══════════════════════════════════════════════════════════
//  4. Summary export
// ═══════════════════════════════════════════════════════════

export function buildSummaryExport(result: AnalysisResult) {
  const uploadId = getUploadId(result);
  const m = result.metrics;
  const stages = m?.stages ?? [];

  function stageMs(name: string): number {
    return stages.find((s) => s.name === name)?.durationMs ?? 0;
  }

  // Average best-score gap: avg of (best.score - 2nd.score) across groups
  let bestScoreGaps: number[] = [];
  for (const g of result.groups) {
    const alive = g.ranked.filter((r) => !r.rejected);
    if (alive.length >= 2) {
      bestScoreGaps.push(alive[0].score - alive[1].score);
    }
  }
  const avgBestScoreGap = bestScoreGaps.length > 0
    ? bestScoreGaps.reduce((a, b) => a + b, 0) / bestScoreGaps.length
    : 0;

  return {
    uploadId,
    exportedAt: new Date().toISOString(),
    version: 'v1',

    summary: {
      totalPhotos: result.totalCount,
      processedPhotos: m?.processedPhotos ?? result.totalCount,
      skippedPhotos: m?.skippedPhotos ?? 0,
      totalGroups: result.groupCount,
      totalCandidates: result.candidateCount,
      filteredCount: result.filteredCount,
      rejectedCount: result.rejectedCount,
    },

    metrics: {
      upload_size: m?.uploadSizeBytes ?? 0,
      preview_generation_time: stageMs('model_load'),
      feature_extraction_time: m?.featureExtractionTimeMs ?? stageMs('feature_extraction'),
      grouping_time: (m?.sceneGroupingTimeMs ?? stageMs('scene_grouping'))
        + (m?.groupSplittingTimeMs ?? stageMs('group_splitting')),
      ranking_time: m?.rankingTimeMs ?? stageMs('scoring_ranking'),
      total_processing_time: m?.totalTimeMs ?? 0,
      total_scene_count: m?.scenesFound ?? 0,
      total_group_count: m?.groupsFound ?? 0,
      total_burst_count: m?.burstsDetected ?? 0,
      singleton_ratio: safeRatio(m?.singletonsFound ?? 0, m?.groupsFound ?? 1),
      hard_reject_ratio: safeRatio(m?.rejectedCount ?? 0, m?.totalPhotos ?? 1),
      average_group_size: safeRatio(m?.totalPhotos ?? 0, m?.groupsFound ?? 1),
      average_best_score_gap: round(avgBestScoreGap),
    },

    stageTimings: stages.map((s) => ({
      name: s.name,
      durationMs: s.durationMs,
    })),

    rejectSummary: result.rejectSummary,

    config: (() => {
      const snap = exportConfigSnapshot();
      return {
        scoring: snap.scoring,
        grouping: snap.grouping,
        ruleFirings: snap.ruleFirings,
      };
    })(),
  };
}

// ═══════════════════════════════════════════════════════════
//  Download helpers
// ═══════════════════════════════════════════════════════════

export function downloadGroupsJSON(result: AnalysisResult): void {
  const data = buildGroupsExport(result);
  downloadJSON(data, `upload_${data.uploadId}_groups.json`);
}

export function downloadScoresJSON(result: AnalysisResult): void {
  const data = buildScoresExport(result);
  downloadJSON(data, `upload_${data.uploadId}_scores.json`);
}

export function downloadFailuresJSON(result: AnalysisResult): void {
  const data = buildFailuresExport(result);
  downloadJSON(data, `upload_${data.uploadId}_failures.json`);
}

export function downloadSummaryJSON(result: AnalysisResult): void {
  const data = buildSummaryExport(result);
  downloadJSON(data, `upload_${data.uploadId}_summary.json`);
}

export function downloadAllExports(result: AnalysisResult): void {
  downloadGroupsJSON(result);
  setTimeout(() => downloadScoresJSON(result), 200);
  setTimeout(() => downloadFailuresJSON(result), 400);
  setTimeout(() => downloadSummaryJSON(result), 600);
}
