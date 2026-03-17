import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as analysisStore from '../lib/analysisStore';
import * as quickScanStore from '../lib/quickScanStore';
import * as previewQueue from '../lib/previewQueue';
import * as feedbackStore from '../lib/feedbackStore';
import * as entitlementStore from '../lib/entitlementStore';
import { ruleTracker } from '../lib/analysisConfig';
import { getModelLoadStatus } from '../lib/faceAnalyzer';

function formatRejectSummary(summary: Record<string, number>): string {
  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason} ${count}장`)
    .join(', ');
}

export default function ResultSummary() {
  const navigate = useNavigate();
  const result = analysisStore.getResult();
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => { feedbackStore.init(); }, []);

  useEffect(() => {
    if (!result) {
      navigate('/', { replace: true });
      return;
    }

    let cancelled = false;
    const thumbIds = result.groups
      .map((g) => g.bestFileId)
      .filter((id): id is string => id != null);

    previewQueue.generatePreviews(thumbIds, (id, url) => {
      if (!cancelled) setPreviews((prev) => ({ ...prev, [id]: url }));
    });
    return () => { cancelled = true; };
  }, [result, navigate]);

  if (!result) return null;

  const stats = [
    { label: '업로드', value: result.totalCount, unit: '장', color: '#3182f6', bg: '#e8f3ff' },
    { label: '묶음', value: result.groupCount, unit: '개', color: '#6b4eff', bg: '#f0ebff' },
    { label: '제외', value: result.filteredCount, unit: '장', color: '#e5503c', bg: '#ffeceb' },
    { label: '추천', value: result.candidateCount, unit: '장', color: '#00b894', bg: '#e6f7f2' },
  ];

  const rejectText = formatRejectSummary(result.rejectSummary);

  return (
    <div className="page">
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>
          분석 완료
        </h1>
      </div>

      <div className="page-body" style={{ gap: 20, paddingTop: 8, paddingBottom: 80 }}>
        {/* Summary subtitle */}
        <p style={{ fontSize: 14, color: '#8b95a1' }}>
          {result.totalCount}장에서 베스트 후보 {result.candidateCount}장을 추렸어요
        </p>

        {/* Stat row */}
        <div style={{ display: 'flex', gap: 8 }}>
          {stats.map((s, i) => (
            <div
              key={s.label}
              style={{
                flex: 1,
                background: s.bg,
                borderRadius: 14,
                padding: '14px 0',
                textAlign: 'center',
                opacity: 0,
                animation: 'fadeUp 0.3s ease forwards',
                animationDelay: `${i * 0.06}s`,
              }}
            >
              <p style={{ fontSize: 11, color: '#6b7684', marginBottom: 4 }}>{s.label}</p>
              <p style={{ fontSize: 22, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>
                {s.value}
                <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 1 }}>{s.unit}</span>
              </p>
            </div>
          ))}
        </div>

        {/* ── 전체 베스트 card ── */}
        <button
          onClick={() => navigate('/group/best')}
          style={{
            width: '100%',
            textAlign: 'left',
            background: 'linear-gradient(135deg, #3182f6, #1b64da)',
            borderRadius: 18,
            padding: '20px 18px',
            color: '#fff',
            opacity: 0,
            animation: 'fadeUp 0.3s ease forwards',
            animationDelay: '0.3s',
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 600, opacity: 0.8, marginBottom: 4 }}>
            👑 전체 베스트
          </p>
          <p style={{ fontSize: 18, fontWeight: 700 }}>
            추천 후보 {result.candidateCount}장 보기
          </p>
          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
            모든 장면에서 가장 잘 나온 사진
          </p>
        </button>

        {/* ── Category grid ── */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#333d4b', marginBottom: 12, letterSpacing: -0.2 }}>
            장면별 결과
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {result.groups.map((group, i) => (
              <button
                key={group.id}
                onClick={() => { feedbackStore.logGroupViewed(group.id); navigate(`/group/${group.id}`); }}
                style={{
                  textAlign: 'left',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: '#fff',
                  boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
                  opacity: 0,
                  animation: 'fadeUp 0.3s ease forwards',
                  animationDelay: `${0.35 + i * 0.05}s`,
                }}
              >
                {/* Thumbnail */}
                <div style={{ width: '100%', aspectRatio: '16/10', background: '#f2f4f6', overflow: 'hidden' }}>
                  {group.bestFileId && previews[group.bestFileId] ? (
                    <img
                      src={previews[group.bestFileId]}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div className="shimmer-box" />
                  )}
                </div>

                {/* Info */}
                <div style={{ padding: '10px 12px 12px' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#191f28', marginBottom: 4 }}>
                    {group.label}
                  </p>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#8b95a1' }}>
                    <span>{group.keptCount}장 추천</span>
                    {group.rejectedCount > 0 && (
                      <span style={{ color: '#e5503c' }}>{group.rejectedCount}장 제외</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Rejected photos card ── */}
        {result.rejectedCount > 0 && (
          <button
            onClick={() => navigate('/group/excluded')}
            style={{
              width: '100%',
              textAlign: 'left',
              background: '#fff8f8',
              borderRadius: 16,
              padding: '16px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              opacity: 0,
              animation: 'fadeUp 0.3s ease forwards',
              animationDelay: '0.6s',
            }}
          >
            <span style={{ fontSize: 22, flexShrink: 0 }}>🚫</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#333d4b', marginBottom: 2 }}>
                제외된 사진 {result.rejectedCount}장
              </p>
              <p style={{ fontSize: 12, color: '#8b95a1', lineHeight: 1.4 }}>
                {rejectText || '왜 제외되었는지 확인해 보세요'}
              </p>
            </div>
            <span style={{ marginLeft: 'auto', fontSize: 16, color: '#adb5bd' }}>›</span>
          </button>
        )}

        {/* Tip */}
        <div style={{ background: '#f2f4f6', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>💡</span>
          <p style={{ fontSize: 13, color: '#6b7684', lineHeight: 1.5 }}>
            사진을 탭하면 크게 볼 수 있어요. 마우스를 올리면 돋보기로 확대됩니다.
          </p>
        </div>

        {/* Pipeline diagnostics — collapsible */}
        {result.metrics && (
          <details style={{ background: '#f8f9fa', borderRadius: 14, padding: '0' }}>
            <summary style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: '#8b95a1', cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, transition: 'transform 0.2s' }}>▶</span>
              파이프라인 진단
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#adb5bd' }}>
                {(result.metrics.totalTimeMs / 1000).toFixed(1)}초 · {result.metrics.photosWithFaces ?? 0}얼굴
              </span>
            </summary>
            <div style={{ padding: '0 16px 14px' }}>
              {/* Model status */}
              {(() => {
                const ms = getModelLoadStatus();
                const allOk = ms.core && ms.recognition && ms.expression;
                return (
                  <div style={{ marginBottom: 8, padding: '5px 10px', borderRadius: 8, background: allOk ? '#e6f7e6' : '#fff3e0', fontSize: 10 }}>
                    <span style={{ fontWeight: 600, color: allOk ? '#2e7d32' : '#e65100' }}>
                      {allOk ? '정상' : '문제'}
                    </span>
                    <span style={{ color: '#6b7684', marginLeft: 6 }}>
                      SSD:{ms.ssd ? '✓' : '✗'} 감지:{ms.core ? '✓' : '✗'} 인식:{ms.recognition ? '✓' : '✗'} 표정:{ms.expression ? '✓' : '✗'} 눈:{ms.mediapipe ? '✓' : '✗(EAR)'}
                    </span>
                  </div>
                );
              })()}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: 11, color: '#6b7684' }}>
                <span>처리 시간</span><span style={{ textAlign: 'right' }}>{(result.metrics.totalTimeMs / 1000).toFixed(1)}초</span>
                <span>얼굴 감지</span>
                <span style={{ textAlign: 'right', color: (result.metrics.photosWithFaces ?? 0) > 0 ? '#2e7d32' : '#e5503c', fontWeight: 600 }}>
                  {result.metrics.photosWithFaces ?? 0}/{result.metrics.processedPhotos}장
                </span>
                <span>장면/그룹</span><span style={{ textAlign: 'right' }}>{result.metrics.scenesFound}/{result.metrics.groupsFound}개</span>
                <span>싱글톤</span><span style={{ textAlign: 'right' }}>{result.metrics.singletonsFound}개</span>
                <span>Hard 제외</span><span style={{ textAlign: 'right', color: result.metrics.rejectedCount > 0 ? '#e5503c' : undefined }}>{result.metrics.rejectedCount}장</span>
              </div>

              {result.metrics.photoTypeDistribution && (
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, color: '#8b95a1' }}>
                  {Object.entries(result.metrics.photoTypeDistribution).map(([type, count]) => (
                    <span key={type} style={{ background: '#e5e8eb', borderRadius: 6, padding: '2px 6px' }}>{type}: {count}</span>
                  ))}
                </div>
              )}

              {Object.keys(result.rejectSummary).length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #e5e8eb' }}>
                  <p style={{ fontSize: 10, fontWeight: 600, color: '#e5503c', marginBottom: 3 }}>제외 사유</p>
                  {Object.entries(result.rejectSummary).sort((a, b) => b[1] - a[1]).map(([code, count]) => (
                    <div key={code} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8b95a1', marginBottom: 1 }}>
                      <span>{code}</span><span>{count}장</span>
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const firings = ruleTracker.getAll().filter((r) => r.count > 0).slice(0, 8);
                if (firings.length === 0) return null;
                return (
                  <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #e5e8eb' }}>
                    <p style={{ fontSize: 10, fontWeight: 600, color: '#6b4eff', marginBottom: 3 }}>규칙 발동</p>
                    {firings.map((r) => (
                      <div key={r.rule} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8b95a1', marginBottom: 1 }}>
                        <span>{r.displayName}</span><span>{r.count}회</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </details>
        )}
      </div>

      <div className="page-footer">
        {quickScanStore.getResult() && (
          <button
            className="btn-secondary"
            style={{ marginBottom: 8 }}
            onClick={() => navigate('/scenes')}
          >
            다른 장면 분석하기
          </button>
        )}
        <button className="btn-primary" onClick={() => navigate('/group/best')}>
          베스트컷 보기
        </button>
        {!entitlementStore.isPremium() && (
          <button
            onClick={() => navigate('/premium')}
            style={{
              marginTop: 8, padding: '10px 0', fontSize: 13, color: '#8b95a1',
              textAlign: 'center', width: '100%',
            }}
          >
            다음엔 광고 없이 바로 분석하기 <span style={{ color: '#6b4eff', fontWeight: 600 }}>프리미엄</span>
          </button>
        )}
      </div>

      {/* Dev-only debug button */}
      {import.meta.env.DEV && (
        <button
          onClick={() => navigate('/debug')}
          style={{
            position: 'fixed',
            bottom: 80,
            right: 16,
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: '#333d4b',
            color: '#fff',
            fontSize: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
            zIndex: 50,
          }}
          title="Debug Inspector"
        >
          🔧
        </button>
      )}
    </div>
  );
}
