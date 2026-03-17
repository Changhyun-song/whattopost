/**
 * Developer-only Debug Inspector.
 *
 * 4 tabs:
 *   1. Photo   — per-photo features, scores, reject reasons
 *   2. Group   — group membership, split evidence, distribution
 *   3. Recommend — global ranking, why-selected, confidence
 *   4. Failure — suspicious cases, low confidence, metrics, thresholds
 *
 * Only accessible via /debug route in dev mode.
 * All data comes from analysisStore (explainability fields).
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as analysisStore from '../lib/analysisStore';
import * as previewQueue from '../lib/previewQueue';
import * as feedbackStore from '../lib/feedbackStore';
import { downloadDebugJSON } from '../lib/debugExport';
import {
  downloadAllExports,
  downloadGroupsJSON,
  downloadScoresJSON,
  downloadFailuresJSON,
  downloadSummaryJSON,
} from '../lib/offlineExport';
import type { AnalysisResult, PhotoGroup, RankedPhoto } from '../lib/mockAnalysis';
import type {
  RecommendationExplanation,
  GroupingDecisionEvidence,
  BestShotScoreBreakdown,
  RejectReason,
  SuspiciousCase,
  LowConfidenceItem,
  ProcessingMetrics,
} from '../lib/explainability';
import { exportConfigSnapshot, ruleTracker } from '../lib/analysisConfig';

// ═══════════════════════════════════════════════════════════
//  Shared micro-components
// ═══════════════════════════════════════════════════════════

const mono: React.CSSProperties = { fontFamily: 'Consolas, "Courier New", monospace', fontSize: 12 };
const sectionStyle: React.CSSProperties = { background: '#f8f9fa', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#8b95a1', marginBottom: 2 };
const valStyle: React.CSSProperties = { ...mono, color: '#191f28' };

function ScoreBar({ value, label, color = '#3182f6' }: { value: number; label: string; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 11, color: '#6b7684', width: 80, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: '#e5e8eb', borderRadius: 3 }}>
        <div style={{ width: `${Math.min(100, value * 100)}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ ...mono, color: '#4e5968', width: 36, textAlign: 'right' }}>
        {(value * 100).toFixed(0)}
      </span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: 'info' | 'warning' | 'error' | 'hard' | 'soft' }) {
  const map: Record<string, { color: string; bg: string }> = {
    info: { color: '#3182f6', bg: '#e8f3ff' },
    warning: { color: '#ff8a00', bg: '#fff4e6' },
    error: { color: '#e5503c', bg: '#ffeceb' },
    hard: { color: '#e5503c', bg: '#ffeceb' },
    soft: { color: '#ff8a00', bg: '#fff4e6' },
  };
  const s = map[severity] ?? map.info;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: s.color, background: s.bg, borderRadius: 4, padding: '2px 6px' }}>
      {severity.toUpperCase()}
    </span>
  );
}

function ConfBadge({ value }: { value: number }) {
  const color = value >= 0.7 ? '#00b894' : value >= 0.4 ? '#ff8a00' : '#e5503c';
  const label = value >= 0.7 ? 'HIGH' : value >= 0.4 ? 'MED' : 'LOW';
  return (
    <span style={{ ...mono, fontSize: 11, fontWeight: 700, color, background: `${color}18`, borderRadius: 4, padding: '2px 6px' }}>
      {label} {(value * 100).toFixed(0)}%
    </span>
  );
}

function Thumb({ src, size = 44 }: { src?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 6, overflow: 'hidden', background: '#f2f4f6', flexShrink: 0 }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
    </div>
  );
}

function SectionTitle({ children, label }: { children?: React.ReactNode; label?: string }) {
  return <h3 style={{ fontSize: 13, fontWeight: 700, color: '#333d4b', marginBottom: 8, marginTop: 14 }}>{label ?? children}</h3>;
}

// ═══════════════════════════════════════════════════════════
//  Tab 1: Photo Inspector
// ═══════════════════════════════════════════════════════════

function PhotoTab({ result, previews }: { result: AnalysisResult; previews: Record<string, string> }) {
  const [selected, setSelected] = useState<string | null>(null);

  const allPhotos = useMemo(() => result.allRanked, [result]);
  const expl = result.explanations?.find((e) => e.fileId === selected);
  const rp = allPhotos.find((p) => p.fileId === selected);

  return (
    <div>
      <p style={{ fontSize: 12, color: '#8b95a1', marginBottom: 8 }}>사진을 클릭하면 상세 정보를 볼 수 있어요</p>

      {/* Thumbnail grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
        {allPhotos.map((p) => (
          <div
            key={p.fileId}
            onClick={() => setSelected(p.fileId)}
            style={{
              width: 44, height: 44, borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
              background: '#f2f4f6',
              border: selected === p.fileId ? '2px solid #3182f6' : '2px solid transparent',
              opacity: p.rejected ? 0.5 : 1,
              position: 'relative',
            }}
          >
            {previews[p.fileId] && <img src={previews[p.fileId]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            {p.rejected && <div style={{ position: 'absolute', inset: 0, background: 'rgba(229,80,60,0.25)' }} />}
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {selected && rp && (
        <div style={{ borderTop: '1px solid #e5e8eb', paddingTop: 12 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <Thumb src={previews[selected]} size={72} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#191f28' }}>{selected}</p>
              <p style={{ fontSize: 12, color: '#8b95a1', marginTop: 2 }}>
                {expl?.scoreBreakdown.context.photoType ?? '—'} · {expl?.scoreBreakdown.composition.framingType ?? '—'}
              </p>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {rp.rejected
                  ? <SeverityBadge severity="hard" />
                  : <span style={{ fontSize: 10, fontWeight: 700, color: '#00b894', background: '#e6f7f2', borderRadius: 4, padding: '2px 6px' }}>PASS</span>}
                {expl && <ConfBadge value={expl.confidence} />}
              </div>
            </div>
          </div>

          {/* Quality scores */}
          <div style={sectionStyle}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#333d4b', marginBottom: 8 }}>Quality Scores</p>
            <ScoreBar value={rp.qualityScores.sharpness} label="선명도" />
            <ScoreBar value={rp.qualityScores.exposure} label="노출" />
            <ScoreBar value={rp.qualityScores.composition} label="구도" />
            <ScoreBar value={rp.qualityScores.eyeOpen} label="눈 뜸" color={rp.qualityScores.eyeOpen < 0.4 ? '#e5503c' : '#3182f6'} />
            <ScoreBar value={rp.qualityScores.expression} label="표정" />
            <ScoreBar value={rp.qualityScores.faceVisibility} label="얼굴 가시성" />
            <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: '#6b7684' }}>
              <span>얼굴 수: <b style={mono}>{rp.qualityScores.faceCount}</b></span>
              <span>얼굴 존재: <b style={mono}>{(rp.qualityScores.facePresence * 100).toFixed(0)}%</b></span>
            </div>
          </div>

          {/* Score breakdown (from explanation) */}
          {expl && <BreakdownSection breakdown={expl.scoreBreakdown} />}

          {/* Reject reasons */}
          {expl && expl.rejectReasons.length > 0 && (
            <div style={sectionStyle}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#e5503c', marginBottom: 6 }}>Reject Reasons</p>
              {expl.rejectReasons.map((r, i) => (
                <RejectRow key={i} reason={r} />
              ))}
            </div>
          )}

          {/* Why selected */}
          {expl && (
            <div style={sectionStyle}>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#333d4b', marginBottom: 6 }}>
                {expl.isRepresentative ? '🏆 대표컷 선정 이유' : '판단 근거'}
              </p>
              {expl.whySelected.map((w, i) => (
                <p key={i} style={{ fontSize: 12, color: '#4e5968', lineHeight: 1.5 }}>· {w}</p>
              ))}
              {expl.comparedTo.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <p style={{ fontSize: 11, color: '#8b95a1', marginBottom: 2 }}>vs 비교</p>
                  {expl.comparedTo.map((c, i) => (
                    <p key={i} style={{ ...mono, fontSize: 11, color: '#6b7684' }}>
                      vs {c.fileId.slice(0, 12)}… → +{(c.scoreDiff * 100).toFixed(1)}pt ({c.mainAdvantage})
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tags + reason */}
          <div style={sectionStyle}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#333d4b', marginBottom: 4 }}>Output</p>
            <p style={{ fontSize: 12, color: '#4e5968' }}>이유: {rp.reason}</p>
            {rp.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                {rp.tags.map((t) => (
                  <span key={t} style={{ fontSize: 10, color: '#00a67e', background: '#edf9f5', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BreakdownSection({ breakdown }: { breakdown: BestShotScoreBreakdown }) {
  const b = breakdown;
  return (
    <div style={sectionStyle}>
      <p style={{ fontSize: 12, fontWeight: 700, color: '#333d4b', marginBottom: 8 }}>Score Breakdown</p>
      <ScoreBar value={b.technical.score} label="Technical" />
      <ScoreBar value={b.subject.score} label="Subject" color={b.subject.hasFace ? '#3182f6' : '#adb5bd'} />
      <ScoreBar value={b.composition.score} label="Composition" />
      <ScoreBar value={b.context.score} label="Context" />
      <ScoreBar value={b.aesthetics.score} label="Aesthetics" color="#e8590c" />
      <ScoreBar value={b.uniqueness.score} label="Uniqueness" />
      <div style={{ borderTop: '1px solid #e5e8eb', marginTop: 6, paddingTop: 6 }}>
        <ScoreBar value={b.total} label="TOTAL" color="#191f28" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px', marginTop: 6 }}>
        <DetailVal label="sharpness" value={b.technical.sharpness} />
        <DetailVal label="exposure" value={b.technical.exposure} />
        <DetailVal label="eyeOpen" value={b.subject.eyeOpenNorm} />
        <DetailVal label="expression" value={b.subject.expressionNorm} />
        <DetailVal label="visibility" value={b.subject.visibilityNorm} />
        <DetailVal label="centering" value={b.subject.centeringNorm} />
        <DetailVal label="faceCut" value={b.subject.faceCutPenalty} />
        <DetailVal label="framingBonus" value={b.composition.framingBonus} />
        <DetailVal label="flattering" value={b.aesthetics.flattering} />
        <DetailVal label="poseNatural" value={b.aesthetics.poseNatural} />
        <DetailVal label="smileQuality" value={b.aesthetics.smileQuality} />
        <DetailVal label="bgSimplicity" value={b.aesthetics.bgSimplicity} />
        <DetailVal label="thirdsScore" value={b.aesthetics.thirdsScore} />
        <DetailVal label="inBurst" value={b.uniqueness.inBurst ? 1 : 0} />
        <DetailVal label="maxSim" value={b.uniqueness.maxGroupSimilarity} />
      </div>
      <p style={{ ...mono, fontSize: 10, color: '#adb5bd', marginTop: 4 }}>
        type={b.context.photoType} | {b.context.typeMatchReason}
      </p>
      <p style={{ ...mono, fontSize: 10, color: '#adb5bd' }}>
        weights: T={b.appliedWeights.technical} S={b.appliedWeights.subject} C={b.appliedWeights.composition} X={b.appliedWeights.context} A={b.appliedWeights.aesthetics}
      </p>
    </div>
  );
}

function DetailVal({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 10, color: '#8b95a1' }}>{label}</span>
      <span style={{ ...mono, fontSize: 10, color: '#4e5968' }}>{value.toFixed(3)}</span>
    </div>
  );
}

function RejectRow({ reason }: { reason: RejectReason }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <SeverityBadge severity={reason.severity} />
      <span style={{ fontSize: 11, color: '#4e5968', flex: 1 }}>{reason.label}</span>
      <span style={{ ...mono, fontSize: 10, color: '#8b95a1' }}>
        {reason.code} | {reason.metric}={reason.value.toFixed(2)} (thr={reason.threshold.toFixed(2)})
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Tab 2: Group Inspector
// ═══════════════════════════════════════════════════════════

function GroupTab({ result, previews }: { result: AnalysisResult; previews: Record<string, string> }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const evidenceMap = useMemo(() => {
    const m = new Map<string, GroupingDecisionEvidence>();
    for (const ev of result.groupEvidence ?? []) m.set(ev.groupId, ev);
    return m;
  }, [result.groupEvidence]);

  return (
    <div>
      <p style={{ fontSize: 12, color: '#8b95a1', marginBottom: 8 }}>
        {result.groupCount}개 그룹 · {result.groupEvidence?.filter((e) => e.isSingleton).length ?? 0} singletons
      </p>

      {result.groups.map((group) => {
        const ev = evidenceMap.get(group.id);
        const isOpen = expandedId === group.id;
        const lowConf = (result.failureReport?.lowConfidenceItems ?? []).filter((l) => l.groupId === group.id);

        return (
          <div key={group.id} style={{ background: '#fff', border: '1px solid #e5e8eb', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
            {/* Header */}
            <button
              onClick={() => setExpandedId(isOpen ? null : group.id)}
              style={{ width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}
            >
              <Thumb src={group.bestFileId ? previews[group.bestFileId] : undefined} size={36} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#191f28' }}>{group.label}</p>
                <p style={{ fontSize: 11, color: '#8b95a1' }}>
                  {group.fileIds.length}장 · {group.keptCount} kept · {group.rejectedCount} rejected
                  {ev?.isSingleton && <span style={{ color: '#ff8a00' }}> · singleton</span>}
                </p>
              </div>
              {lowConf.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#ff8a00', background: '#fff4e6', borderRadius: 4, padding: '2px 6px' }}>
                  ⚠ {lowConf.length}
                </span>
              )}
              <span style={{ color: '#adb5bd', fontSize: 14, transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>›</span>
            </button>

            {/* Expanded content */}
            {isOpen && (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f2f4f6' }}>
                {/* Members */}
                <SectionTitle>Members</SectionTitle>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                  {group.ranked.map((p) => (
                    <div key={p.fileId} style={{ position: 'relative' }}>
                      <Thumb src={previews[p.fileId]} size={40} />
                      {p.fileId === group.bestFileId && (
                        <div style={{ position: 'absolute', top: -2, right: -2, fontSize: 10, background: '#ff8a00', color: '#fff', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>★</div>
                      )}
                      {p.rejected && <div style={{ position: 'absolute', inset: 0, borderRadius: 6, background: 'rgba(229,80,60,0.3)' }} />}
                    </div>
                  ))}
                </div>

                {/* Score ranking within group */}
                <SectionTitle>Ranking</SectionTitle>
                <div style={{ fontSize: 11 }}>
                  {group.ranked.map((p, i) => {
                    const ex = result.explanations?.find((e) => e.fileId === p.fileId);
                    return (
                      <div key={p.fileId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', color: p.rejected ? '#adb5bd' : '#4e5968' }}>
                        <span style={{ ...mono, width: 18, textAlign: 'right', color: '#8b95a1' }}>#{i + 1}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.fileId.slice(0, 16)}…
                        </span>
                        <span style={mono}>{(p.score * 100).toFixed(1)}</span>
                        {ex && <ConfBadge value={ex.confidence} />}
                        {p.rejected && <span style={{ fontSize: 9, color: '#e5503c' }}>✕</span>}
                      </div>
                    );
                  })}
                </div>

                {/* Split evidence */}
                {ev && (
                  <>
                    <SectionTitle>Split Evidence</SectionTitle>
                    <div style={sectionStyle}>
                      <p style={{ fontSize: 11, color: '#6b7684', marginBottom: 4 }}>scene: {ev.sceneId} · faces: {ev.faceCount} · framing: {ev.framingType}</p>
                      {ev.appliedRules.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#3182f6', background: '#e8f3ff', borderRadius: 4, padding: '1px 5px' }}>{r.rule}</span>
                          <span style={{ fontSize: 11, color: '#4e5968', flex: 1 }}>{r.description}</span>
                          <span style={{ ...mono, fontSize: 10, color: '#8b95a1' }}>→ {r.bucketsAfter} buckets</span>
                        </div>
                      ))}
                      {ev.burstSubgroups > 0 && (
                        <p style={{ fontSize: 11, color: '#ff8a00', marginTop: 4 }}>burst subgroups: {ev.burstSubgroups}</p>
                      )}
                    </div>
                  </>
                )}

                {/* Face count distribution */}
                <SectionTitle>Face Count Distribution</SectionTitle>
                <FaceCountDist ranked={group.ranked} qualityScores={group.ranked.map((r) => r.qualityScores)} />

                {/* Low confidence warnings */}
                {lowConf.length > 0 && (
                  <>
                    <SectionTitle>⚠ Low Confidence</SectionTitle>
                    {lowConf.map((lc, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#ff8a00', marginBottom: 2 }}>
                        {lc.fileId.slice(0, 16)}… — conf {(lc.confidence * 100).toFixed(0)}% — {lc.reasons.join(', ')}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FaceCountDist({ ranked, qualityScores }: { ranked: RankedPhoto[]; qualityScores: RankedPhoto['qualityScores'][] }) {
  const dist = new Map<number, number>();
  for (const qs of qualityScores) {
    dist.set(qs.faceCount, (dist.get(qs.faceCount) ?? 0) + 1);
  }
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
      {Array.from(dist.entries()).sort((a, b) => a[0] - b[0]).map(([fc, count]) => (
        <span key={fc} style={{ ...mono, color: '#4e5968', background: '#f2f4f6', borderRadius: 4, padding: '2px 8px' }}>
          {fc}faces: {count}
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Tab 3: Recommendation Inspector
// ═══════════════════════════════════════════════════════════

function RecommendTab({ result, previews }: { result: AnalysisResult; previews: Record<string, string> }) {
  const suspicious = result.failureReport?.suspiciousCases ?? [];

  return (
    <div>
      {/* Suspicious warnings */}
      {suspicious.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <SectionTitle>⚠ Suspicious Cases</SectionTitle>
          {suspicious.map((s, i) => (
            <SuspiciousRow key={i} item={s} />
          ))}
        </div>
      )}

      {/* Candidates */}
      <SectionTitle>추천 후보 ({result.candidateCount})</SectionTitle>
      {result.candidates.map((c, i) => {
        const expl = result.explanations?.find((e) => e.fileId === c.fileId);
        return (
          <div key={c.fileId} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #f2f4f6', alignItems: 'flex-start' }}>
            <span style={{ ...mono, fontSize: 12, color: '#8b95a1', width: 20, paddingTop: 4 }}>#{i + 1}</span>
            <Thumb src={previews[c.fileId]} size={52} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#191f28' }}>{(c.score * 100).toFixed(1)}pt</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: c.category === 'best' ? '#ff8a00' : '#3182f6', background: c.category === 'best' ? '#fff4e6' : '#e8f3ff', borderRadius: 4, padding: '1px 5px' }}>
                  {c.tag}
                </span>
                {expl && <ConfBadge value={expl.confidence} />}
              </div>
              <p style={{ fontSize: 11, color: '#4e5968', lineHeight: 1.4 }}>{c.reason}</p>
              {expl && expl.whySelected.length > 0 && (
                <p style={{ fontSize: 10, color: '#8b95a1', marginTop: 2 }}>
                  {expl.whySelected[0]}
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* Full ranking */}
      <SectionTitle>전체 점수 순위 (top 30)</SectionTitle>
      <div style={{ fontSize: 11 }}>
        {result.allRanked.slice(0, 30).map((p, i) => {
          const expl = result.explanations?.find((e) => e.fileId === p.fileId);
          return (
            <div key={p.fileId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px solid #fafafa' }}>
              <span style={{ ...mono, width: 22, textAlign: 'right', color: '#adb5bd' }}>{i + 1}</span>
              <Thumb src={previews[p.fileId]} size={28} />
              <span style={{ ...mono, flex: 1, color: p.rejected ? '#adb5bd' : '#191f28' }}>{(p.score * 100).toFixed(1)}</span>
              {expl && <ConfBadge value={expl.confidence} />}
              {p.rejected && <span style={{ fontSize: 9, color: '#e5503c', fontWeight: 700 }}>REJECT</span>}
              {p.tags.length > 0 && <span style={{ fontSize: 9, color: '#00a67e' }}>{p.tags[0]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SuspiciousRow({ item }: { item: SuspiciousCase }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', background: item.severity === 'warning' ? '#fff8f0' : '#f0f7ff', borderRadius: 8, marginBottom: 6 }}>
      <SeverityBadge severity={item.severity} />
      <div>
        <p style={{ fontSize: 12, color: '#333d4b', fontWeight: 600 }}>{item.type}</p>
        <p style={{ fontSize: 11, color: '#6b7684', lineHeight: 1.4 }}>{item.description}</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Tab 6: Config & Rule Firing
// ═══════════════════════════════════════════════════════════

function ConfigTab() {
  const snap = exportConfigSnapshot();
  const { scoring, grouping, ruleFirings } = snap;

  function renderConfigSection(title: string, obj: Record<string, unknown>, depth = 0) {
    return (
      <div style={{ marginLeft: depth * 12 }}>
        {Object.entries(obj).map(([key, val]) => {
          if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            return (
              <div key={key} style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b4eff', marginTop: 6, marginBottom: 2 }}>{key}</div>
                {renderConfigSection('', val as Record<string, unknown>, depth + 1)}
              </div>
            );
          }
          return (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1, fontSize: 11 }}>
              <span style={{ color: '#4e5968' }}>{key}</span>
              <span style={{ ...mono, color: '#191f28', fontWeight: 600 }}>{String(val)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Rule Firing Stats */}
      <SectionTitle label={`Rule Firing (${ruleFirings.length} rules)`} />
      {ruleFirings.length === 0 ? (
        <p style={{ fontSize: 12, color: '#8b95a1' }}>아직 분석을 실행하지 않아 rule firing 기록이 없습니다.</p>
      ) : (
        <div style={sectionStyle}>
          {ruleFirings.map((rf) => (
            <div key={rf.rule} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: '#4e5968', fontWeight: 600 }}>{rf.rule}</span>
                <span style={{ color: '#8b95a1', marginLeft: 6 }}>{rf.displayName}</span>
              </div>
              <span style={{
                ...mono,
                fontSize: 11,
                fontWeight: 700,
                color: rf.count > 10 ? '#e5503c' : rf.count > 3 ? '#ff8a00' : '#00b894',
                background: rf.count > 10 ? '#ffeceb' : rf.count > 3 ? '#fff8f0' : '#e6f7f2',
                padding: '1px 8px',
                borderRadius: 4,
              }}>
                {rf.count}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Config export */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => {
            const json = JSON.stringify(snap, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `whattopost-config-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
          style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: '#3182f6', color: '#fff', fontSize: 12, fontWeight: 600 }}
        >
          Config + Firings JSON ↓
        </button>
        <button
          onClick={() => { ruleTracker.reset(); window.location.reload(); }}
          style={{ padding: '8px 14px', borderRadius: 8, background: '#f8f9fa', color: '#e5503c', fontSize: 12, fontWeight: 600 }}
        >
          Reset Firings
        </button>
      </div>

      {/* ScoringConfig */}
      <SectionTitle label="ScoringConfig (현재 값)" />
      <div style={sectionStyle}>
        {renderConfigSection('scoring', scoring as unknown as Record<string, unknown>)}
      </div>

      {/* GroupingConfig */}
      <SectionTitle label="GroupingConfig (현재 값)" />
      <div style={sectionStyle}>
        {renderConfigSection('grouping', grouping as unknown as Record<string, unknown>)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Tab 5: Feedback Inspector
// ═══════════════════════════════════════════════════════════

function FeedbackTab({ result }: { result: AnalysisResult }) {
  const events = feedbackStore.getEvents();
  const summary = feedbackStore.buildSessionSummary();
  const savedIds = feedbackStore.getSavedIds();
  const dismissedIds = feedbackStore.getDismissedIds();

  const typeLabel: Record<string, string> = {
    top1_accepted: 'Top-1 수용',
    top3_accepted: 'Top-3 수용',
    recommendation_overridden: '추천 무시 (다른 사진 선택)',
    mixed: '혼합',
    no_selection: '아직 선택 없음',
  };

  const eventTypeLabel: Record<string, string> = {
    photo_viewed: '사진 열람',
    photo_saved: '사진 저장',
    photo_dismissed: '사진 제외',
    recommendation_accepted: '추천 수용',
    recommendation_overridden: '추천 무시',
    group_viewed: '그룹 열람',
  };

  const eventCounts = events.reduce<Record<string, number>>((acc, ev) => {
    acc[ev.type] = (acc[ev.type] || 0) + 1;
    return acc;
  }, {});

  const recommendedIds = result.candidates.map((c) => c.fileId);
  const savedRecommended = savedIds.filter((id) => recommendedIds.includes(id));
  const savedNonRecommended = savedIds.filter((id) => !recommendedIds.includes(id));
  const dismissedRecommended = dismissedIds.filter((id) => recommendedIds.includes(id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Session Summary */}
      <SectionTitle label="세션 요약" />
      <div style={{ background: '#f8f9fa', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <MetricRow label="세션 ID" value={summary.sessionId} />
        <MetricRow label="피드백 유형" value={typeLabel[summary.feedbackType] || summary.feedbackType} />
        <MetricRow label="총 이벤트" value={events.length} />
        <MetricRow label="열람한 사진" value={summary.context.viewedCount} />
        <MetricRow label="저장한 사진" value={summary.context.savedCount} />
        <MetricRow label="제외한 사진" value={summary.context.dismissedCount} />
      </div>

      {/* Acceptance Stats */}
      <SectionTitle label="추천 수용률" />
      <div style={{ background: '#f8f9fa', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <MetricRow label="추천 사진 수" value={recommendedIds.length} />
        <MetricRow label="추천 중 저장" value={`${savedRecommended.length} / ${recommendedIds.length}`} />
        <MetricRow label="비추천 사진 저장" value={savedNonRecommended.length} />
        <MetricRow label="추천 사진 제외" value={dismissedRecommended.length} />
        {recommendedIds.length > 0 && (
          <MetricRow
            label="추천 수용률"
            value={`${Math.round((savedRecommended.length / recommendedIds.length) * 100)}%`}
          />
        )}
      </div>

      {/* Saved photos */}
      {savedIds.length > 0 && (
        <>
          <SectionTitle label={`저장된 사진 (${savedIds.length})`} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {savedIds.map((id) => {
              const inRec = recommendedIds.includes(id);
              const rank = result.allRanked.findIndex((r) => r.fileId === id);
              return (
                <span key={id} style={{
                  ...mono, fontSize: 11, padding: '3px 8px', borderRadius: 6,
                  background: inRec ? '#e6f7f2' : '#fff3e0',
                  color: inRec ? '#00b894' : '#e65100',
                }}>
                  {id.slice(0, 8)}… {inRec ? '추천' : '비추천'} #{rank + 1}
                </span>
              );
            })}
          </div>
        </>
      )}

      {/* Dismissed photos */}
      {dismissedIds.length > 0 && (
        <>
          <SectionTitle label={`제외된 사진 (${dismissedIds.length})`} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {dismissedIds.map((id) => {
              const inRec = recommendedIds.includes(id);
              return (
                <span key={id} style={{
                  ...mono, fontSize: 11, padding: '3px 8px', borderRadius: 6,
                  background: '#fff8f0', color: '#ff8a00',
                }}>
                  {id.slice(0, 8)}… {inRec ? '추천이었음' : '비추천'}
                </span>
              );
            })}
          </div>
        </>
      )}

      {/* Event Distribution */}
      <SectionTitle label="이벤트 분포" />
      <div style={{ background: '#f8f9fa', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
          <MetricRow key={type} label={eventTypeLabel[type] || type} value={count} />
        ))}
        {Object.keys(eventCounts).length === 0 && (
          <p style={{ fontSize: 12, color: '#8b95a1' }}>아직 이벤트가 없습니다. 결과 페이지에서 사진과 상호작용하면 여기에 기록됩니다.</p>
        )}
      </div>

      {/* Event Timeline */}
      <SectionTitle label={`이벤트 타임라인 (최근 50건)`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {events.length === 0 && (
          <p style={{ fontSize: 12, color: '#8b95a1' }}>이벤트 없음</p>
        )}
        {events.slice(-50).reverse().map((ev) => (
          <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', background: '#f8f9fa', borderRadius: 8, fontSize: 11 }}>
            <span style={{ ...mono, color: '#8b95a1', flexShrink: 0 }}>
              {new Date(ev.timestamp).toLocaleTimeString('ko-KR')}
            </span>
            <span style={{
              padding: '2px 6px', borderRadius: 4, fontWeight: 600, flexShrink: 0,
              background:
                ev.type === 'photo_saved' ? '#e6f7f2' :
                ev.type === 'photo_dismissed' ? '#fff3e0' :
                ev.type === 'recommendation_accepted' ? '#e8f3ff' :
                ev.type === 'recommendation_overridden' ? '#ffeceb' :
                '#f2f4f6',
              color:
                ev.type === 'photo_saved' ? '#00b894' :
                ev.type === 'photo_dismissed' ? '#ff8a00' :
                ev.type === 'recommendation_accepted' ? '#3182f6' :
                ev.type === 'recommendation_overridden' ? '#e5503c' :
                '#6b7684',
            }}>
              {eventTypeLabel[ev.type] || ev.type}
            </span>
            {ev.photoId && <span style={{ ...mono, color: '#333d4b' }}>{ev.photoId.slice(0, 10)}…</span>}
            {ev.context.rank != null && <span style={{ ...mono, color: '#8b95a1' }}>#{ev.context.rank + 1}</span>}
            {ev.context.wasRecommended != null && (
              <span style={{ ...mono, color: ev.context.wasRecommended ? '#00b894' : '#8b95a1' }}>
                {ev.context.wasRecommended ? '추천' : '비추천'}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Export */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
        <button
          onClick={() => feedbackStore.downloadFeedbackJSON()}
          style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: '#3182f6', color: '#fff', fontSize: 13, fontWeight: 600 }}
        >
          피드백 JSON 내보내기
        </button>
        <button
          onClick={() => { feedbackStore.clear(); window.location.reload(); }}
          style={{ padding: '10px 16px', borderRadius: 10, background: '#f8f9fa', color: '#e5503c', fontSize: 13, fontWeight: 600 }}
        >
          초기화
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Tab 4: Failure Inspector
// ═══════════════════════════════════════════════════════════

function FailureTab({ result }: { result: AnalysisResult }) {
  const report = result.failureReport;
  const metrics = result.metrics;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── Offline Export ── */}
      <SectionTitle label="Offline Export" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {[
          { label: 'Groups JSON', fn: () => downloadGroupsJSON(result) },
          { label: 'Scores JSON', fn: () => downloadScoresJSON(result) },
          { label: 'Failures JSON', fn: () => downloadFailuresJSON(result) },
          { label: 'Summary JSON', fn: () => downloadSummaryJSON(result) },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.fn}
            style={{ padding: '6px 12px', borderRadius: 8, background: '#e8f3ff', color: '#3182f6', fontSize: 11, fontWeight: 600 }}
          >
            {btn.label} ↓
          </button>
        ))}
        <button
          onClick={() => downloadAllExports(result)}
          style={{ padding: '6px 14px', borderRadius: 8, background: '#3182f6', color: '#fff', fontSize: 11, fontWeight: 600 }}
        >
          전체 내보내기 ↓
        </button>
      </div>

      {/* ── Processing metrics ── */}
      {metrics && (
        <>
          <SectionTitle label="Processing Metrics" />
          <div style={sectionStyle}>
            <MetricRow label="Upload ID" value={result.uploadId ?? '—'} />
            <MetricRow label="Upload size" value={metrics.uploadSizeBytes ? `${(metrics.uploadSizeBytes / 1024 / 1024).toFixed(1)} MB` : '—'} />
            <MetricRow label="Total photos" value={metrics.totalPhotos} />
            <MetricRow label="Processed" value={metrics.processedPhotos} />
            <MetricRow label="Skipped" value={metrics.skippedPhotos} />
            <MetricRow label="Total time" value={`${metrics.totalTimeMs}ms`} />
            <MetricRow label="Avg feature extraction" value={`${metrics.avgFeatureExtractionMs}ms`} />
            <MetricRow label="Scenes" value={metrics.scenesFound} />
            <MetricRow label="Groups" value={metrics.groupsFound} />
            <MetricRow label="Singletons" value={metrics.singletonsFound} />
            <MetricRow label="Bursts" value={metrics.burstsDetected} />
            <MetricRow label="Rejected (hard)" value={metrics.rejectedCount - metrics.softRejectedCount} />
            <MetricRow label="Rejected (soft)" value={metrics.softRejectedCount} />
            <MetricRow label="Candidates" value={metrics.candidateCount} />
          </div>

          {/* Extended ratios */}
          <SectionTitle label="Derived Ratios" />
          <div style={sectionStyle}>
            <MetricRow label="Singleton ratio" value={metrics.singletonRatio != null ? `${(metrics.singletonRatio * 100).toFixed(1)}%` : '—'} />
            <MetricRow label="Hard reject ratio" value={metrics.hardRejectRatio != null ? `${(metrics.hardRejectRatio * 100).toFixed(1)}%` : '—'} />
            <MetricRow label="Avg group size" value={metrics.averageGroupSize != null ? metrics.averageGroupSize.toFixed(1) : '—'} />
            <MetricRow label="Avg best-score gap" value={metrics.averageBestScoreGap != null ? metrics.averageBestScoreGap.toFixed(3) : '—'} />
          </div>

          {/* Stage timings */}
          <SectionTitle label="Stage Timings" />
          <div style={sectionStyle}>
            {metrics.stages.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: '#4e5968' }}>{s.name}</span>
                <span style={{ ...mono, fontSize: 11, color: '#191f28' }}>{s.durationMs}ms</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Likely Failure Reasons ── */}
      <SectionTitle label={`Likely Failure Reasons (${report?.likelyFailureReasons?.length ?? 0})`} />
      {(report?.likelyFailureReasons ?? []).length === 0 ? (
        <p style={{ fontSize: 12, color: '#8b95a1' }}>자동 진단된 실패 원인 없음 ✓</p>
      ) : (
        (report?.likelyFailureReasons ?? []).map((r, i) => (
          <div key={i} style={{ padding: '6px 10px', borderRadius: 8, marginBottom: 4, fontSize: 11, background: r.severity === 'error' ? '#ffeceb' : r.severity === 'warning' ? '#fff8f0' : '#f8f9fa' }}>
            <div style={{ fontWeight: 600, color: r.severity === 'error' ? '#e5503c' : r.severity === 'warning' ? '#ff8a00' : '#6b7684' }}>
              [{r.code}] {r.description}
            </div>
            <div style={{ color: '#8b95a1', marginTop: 2 }}>evidence: {r.evidence}</div>
          </div>
        ))
      )}

      {/* ── Threshold Tuning Candidates ── */}
      <SectionTitle label={`Threshold Tuning (${report?.thresholdTuningCandidates?.length ?? 0})`} />
      {(report?.thresholdTuningCandidates ?? []).length === 0 ? (
        <p style={{ fontSize: 12, color: '#8b95a1' }}>조정 후보 없음 ✓</p>
      ) : (
        (report?.thresholdTuningCandidates ?? []).map((t, i) => (
          <div key={i} style={{ padding: '6px 10px', borderRadius: 8, marginBottom: 4, fontSize: 11, background: '#f0ebff' }}>
            <div style={{ fontWeight: 600, color: '#6b4eff' }}>
              {t.metric} — {t.suggestedDirection === 'loosen' ? '완화 권장 ↓' : '강화 권장 ↑'}
            </div>
            <div style={{ color: '#4e5968', marginTop: 2 }}>{t.reason}</div>
            <div style={{ ...mono, color: '#8b95a1', marginTop: 2 }}>
              current: {t.currentThreshold} | affected: {t.affectedCount} ({(t.affectedRatio * 100).toFixed(1)}%)
            </div>
          </div>
        ))
      )}

      {/* ── Suspicious cases ── */}
      <SectionTitle label={`Suspicious Cases (${report?.suspiciousCases.length ?? 0})`} />
      {(report?.suspiciousCases ?? []).length === 0 ? (
        <p style={{ fontSize: 12, color: '#8b95a1' }}>이상 케이스 없음 ✓</p>
      ) : (
        report!.suspiciousCases.map((s, i) => <SuspiciousRow key={i} item={s} />)
      )}

      {/* ── Low confidence ── */}
      <SectionTitle label={`Low Confidence (${report?.lowConfidenceItems.length ?? 0})`} />
      {(report?.lowConfidenceItems ?? []).length === 0 ? (
        <p style={{ fontSize: 12, color: '#8b95a1' }}>신뢰도 낮은 추천 없음 ✓</p>
      ) : (
        (report?.lowConfidenceItems ?? []).map((lc, i) => (
          <div key={i} style={{ fontSize: 11, color: '#ff8a00', padding: '4px 0' }}>
            <b>{lc.fileId.slice(0, 18)}…</b> (group: {lc.groupId}) — conf: {(lc.confidence * 100).toFixed(0)}%
            {lc.reasons.length > 0 && <span style={{ color: '#8b95a1' }}> — {lc.reasons.join(', ')}</span>}
          </div>
        ))
      )}

      {/* ── Reject distribution ── */}
      <SectionTitle label="Reject Distribution" />
      <div style={sectionStyle}>
        {Object.entries(metrics?.rejectDistribution ?? {}).sort((a, b) => b[1] - a[1]).map(([code, count]) => (
          <div key={code} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 11, color: '#4e5968' }}>{code}</span>
            <span style={{ ...mono, fontSize: 11, color: '#e5503c', fontWeight: 700 }}>{count}</span>
          </div>
        ))}
        {Object.keys(metrics?.rejectDistribution ?? {}).length === 0 && (
          <p style={{ fontSize: 11, color: '#8b95a1' }}>탈락 없음</p>
        )}
      </div>

      {/* ── Score distribution ── */}
      <SectionTitle label="Score Distribution" />
      <div style={sectionStyle}>
        {(report?.scoreDistribution ?? []).map((d) => (
          <div key={d.range} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ ...mono, fontSize: 11, color: '#8b95a1', width: 50 }}>{d.range}</span>
            <div style={{ flex: 1, height: 8, background: '#e5e8eb', borderRadius: 4 }}>
              <div style={{ width: `${Math.min(100, (d.count / Math.max(1, result.totalCount)) * 100 * 3)}%`, height: '100%', background: '#6b4eff', borderRadius: 4 }} />
            </div>
            <span style={{ ...mono, fontSize: 11, width: 24, textAlign: 'right' }}>{d.count}</span>
          </div>
        ))}
      </div>

      {/* ── Group size distribution ── */}
      <SectionTitle label="Group Size Distribution" />
      <div style={sectionStyle}>
        {(report?.groupSizeDistribution ?? []).map((d) => (
          <div key={d.size} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={{ fontSize: 11, color: '#4e5968' }}>{d.size}장 그룹</span>
            <span style={{ ...mono, fontSize: 11 }}>{d.count}개</span>
          </div>
        ))}
      </div>

      {/* ── Warnings ── */}
      {(report?.warnings ?? []).length > 0 && (
        <>
          <SectionTitle label="Warnings" />
          {report!.warnings.map((w, i) => (
            <p key={i} style={{ fontSize: 12, color: '#ff8a00', marginBottom: 2 }}>⚠ {w}</p>
          ))}
        </>
      )}
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
      <span style={{ fontSize: 11, color: '#6b7684' }}>{label}</span>
      <span style={{ ...mono, fontSize: 11, color: '#191f28', fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════

type Tab = 'photo' | 'group' | 'recommend' | 'failure' | 'feedback' | 'config';

const TAB_DEFS: { id: Tab; label: string; icon: string }[] = [
  { id: 'photo', label: 'Photo', icon: '📷' },
  { id: 'group', label: 'Group', icon: '📁' },
  { id: 'recommend', label: 'Recommend', icon: '⭐' },
  { id: 'failure', label: 'Failure', icon: '🔍' },
  { id: 'feedback', label: 'Feedback', icon: '📊' },
  { id: 'config', label: 'Config', icon: '⚙' },
];

export default function DebugInspector() {
  const navigate = useNavigate();
  const result = analysisStore.getResult();
  const [tab, setTab] = useState<Tab>('photo');
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!result) {
      navigate('/', { replace: true });
      return;
    }
    let cancelled = false;
    const allIds = result.allRanked.map((r) => r.fileId);
    previewQueue.generatePreviews(allIds, (id, url) => {
      if (!cancelled) setPreviews((prev) => ({ ...prev, [id]: url }));
    });
    return () => { cancelled = true; };
  }, [result, navigate]);

  if (!result) return null;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '0 16px', minHeight: '100dvh', background: '#fff' }}>
      {/* Header */}
      <div style={{ padding: '16px 0 8px', display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, background: '#fff', zIndex: 10, borderBottom: '1px solid #e5e8eb' }}>
        <button onClick={() => navigate('/result')} style={{ fontSize: 20, color: '#333d4b', lineHeight: 1 }}>‹</button>
        <h1 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>🔧 Debug Inspector</h1>
        <button
          onClick={() => downloadDebugJSON(result)}
          style={{ fontSize: 11, fontWeight: 600, color: '#3182f6', background: '#e8f3ff', borderRadius: 6, padding: '5px 10px' }}
        >
          JSON ↓
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 0', position: 'sticky', top: 48, background: '#fff', zIndex: 9 }}>
        {TAB_DEFS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? '#3182f6' : '#8b95a1',
              background: tab === t.id ? '#e8f3ff' : 'transparent',
              transition: 'all 0.15s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ paddingTop: 8, paddingBottom: 40 }}>
        {tab === 'photo' && <PhotoTab result={result} previews={previews} />}
        {tab === 'group' && <GroupTab result={result} previews={previews} />}
        {tab === 'recommend' && <RecommendTab result={result} previews={previews} />}
        {tab === 'failure' && <FailureTab result={result} />}
        {tab === 'feedback' && <FeedbackTab result={result} />}
        {tab === 'config' && <ConfigTab />}
      </div>
    </div>
  );
}
