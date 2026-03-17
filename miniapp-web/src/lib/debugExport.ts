/**
 * Debug JSON export — serializes all analysis data for inspection.
 *
 * Usage:
 *   import { downloadDebugJSON } from './debugExport';
 *   downloadDebugJSON(analysisResult);
 *
 * Handles Float32Array serialization (truncates to 4 decimal places for size).
 * Output includes: summary, groups, candidates, explanations, evidence,
 * metrics, failure report, reject distribution, score distribution.
 */

import type { AnalysisResult } from './mockAnalysis';

function round(n: number, decimals = 4): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function serializeScores(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v instanceof Float32Array) {
      out[k] = `[Float32Array len=${v.length}]`;
    } else if (typeof v === 'number') {
      out[k] = round(v);
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = serializeScores(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function buildDebugBundle(result: AnalysisResult): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    version: 'v3-explainability',

    summary: {
      totalCount: result.totalCount,
      groupCount: result.groupCount,
      filteredCount: result.filteredCount,
      rejectedCount: result.rejectedCount,
      candidateCount: result.candidateCount,
    },

    rejectSummary: result.rejectSummary,

    groups: result.groups.map((g) => ({
      id: g.id,
      label: g.label,
      photoCount: g.fileIds.length,
      bestFileId: g.bestFileId,
      keptCount: g.keptCount,
      rejectedCount: g.rejectedCount,
      ranked: g.ranked.map((r) => ({
        fileId: r.fileId,
        score: round(r.score),
        rejected: r.rejected,
        rejectReason: r.rejectReason,
        tags: r.tags,
        reason: r.reason,
        qualityScores: serializeScores(r.qualityScores as unknown as Record<string, unknown>),
      })),
    })),

    candidates: result.candidates.map((c) => ({
      fileId: c.fileId,
      score: round(c.score),
      category: c.category,
      tag: c.tag,
      reason: c.reason,
    })),

    explanations: result.explanations?.map((e) => ({
      fileId: e.fileId,
      groupId: e.groupId,
      rank: e.rank,
      isRepresentative: e.isRepresentative,
      confidence: round(e.confidence),
      lowConfidence: e.lowConfidence,
      lowConfidenceReason: e.lowConfidenceReason,
      whySelected: e.whySelected,
      comparedTo: e.comparedTo.map((c) => ({
        fileId: c.fileId,
        scoreDiff: round(c.scoreDiff),
        mainAdvantage: c.mainAdvantage,
      })),
      rejectReasons: e.rejectReasons.map((r) => ({
        code: r.code,
        label: r.label,
        severity: r.severity,
        metric: r.metric,
        value: round(r.value),
        threshold: round(r.threshold),
      })),
      scoreBreakdown: serializeScores(e.scoreBreakdown as unknown as Record<string, unknown>),
    })) ?? [],

    groupEvidence: result.groupEvidence?.map((ev) => ({
      groupId: ev.groupId,
      sceneId: ev.sceneId,
      memberCount: ev.memberCount,
      faceCount: ev.faceCount,
      framingType: ev.framingType,
      burstSubgroups: ev.burstSubgroups,
      isSingleton: ev.isSingleton,
      appliedRules: ev.appliedRules.map((r) => ({
        rule: r.rule,
        description: r.description,
        threshold: r.threshold,
        bucketsAfter: r.bucketsAfter,
      })),
    })) ?? [],

    metrics: result.metrics
      ? {
          totalPhotos: result.metrics.totalPhotos,
          processedPhotos: result.metrics.processedPhotos,
          skippedPhotos: result.metrics.skippedPhotos,
          totalTimeMs: result.metrics.totalTimeMs,
          avgFeatureExtractionMs: result.metrics.avgFeatureExtractionMs,
          stages: result.metrics.stages,
          scenesFound: result.metrics.scenesFound,
          groupsFound: result.metrics.groupsFound,
          singletonsFound: result.metrics.singletonsFound,
          burstsDetected: result.metrics.burstsDetected,
          rejectedCount: result.metrics.rejectedCount,
          softRejectedCount: result.metrics.softRejectedCount,
          candidateCount: result.metrics.candidateCount,
          rejectDistribution: result.metrics.rejectDistribution,
        }
      : null,

    failureReport: result.failureReport
      ? {
          suspiciousCases: result.failureReport.suspiciousCases,
          lowConfidenceItems: result.failureReport.lowConfidenceItems,
          warnings: result.failureReport.warnings,
          groupSizeDistribution: result.failureReport.groupSizeDistribution,
          scoreDistribution: result.failureReport.scoreDistribution,
        }
      : null,
  };
}

export function downloadDebugJSON(result: AnalysisResult, filename?: string): void {
  const bundle = buildDebugBundle(result);
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `whattopost-debug-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
