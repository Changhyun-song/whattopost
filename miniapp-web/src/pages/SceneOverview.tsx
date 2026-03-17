import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as quickScanStore from '../lib/quickScanStore';
import * as previewQueue from '../lib/previewQueue';
import * as adStore from '../lib/adStore';
import * as entitlementStore from '../lib/entitlementStore';
import type { QuickScanScene } from '../lib/mockAnalysis';
import type { AdState } from '../lib/adStore';

const SceneCard = memo(function SceneCard({
  scene,
  index,
  premium,
  adState,
  unlocked,
  onAnalyze,
}: {
  scene: QuickScanScene;
  index: number;
  premium: boolean;
  adState: AdState;
  unlocked: boolean;
  onAnalyze: (sceneId: string) => void;
}) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const ids = scene.photoIds.slice(0, 4);
    previewQueue.generatePreviews(ids, (id, url) => {
      if (!cancelled) setThumbs((prev) => ({ ...prev, [id]: url }));
    });
    return () => { cancelled = true; };
  }, [visible, scene.photoIds]);

  const cols = scene.photoCount >= 4 ? 4 : scene.photoCount >= 3 ? 3 : scene.photoCount >= 2 ? 2 : 1;

  const effectiveUnlocked = premium || unlocked;
  const adReady = adState === 'ready' || effectiveUnlocked;
  const adLoading = !premium && adState === 'preloading';

  // CTA copy: clear about what happens
  const ctaLabel = effectiveUnlocked
    ? '베스트컷 찾기'
    : adReady
      ? '광고 보고 베스트컷 찾기'
      : adLoading
        ? '준비 중...'
        : '베스트컷 찾기';

  const ctaBg = effectiveUnlocked ? '#3182f6' : adReady ? '#3182f6' : adLoading ? '#adb5bd' : '#3182f6';
  const disabled = adLoading || adState === 'showing';

  return (
    <button
      ref={cardRef}
      onClick={() => !disabled && onAnalyze(scene.id)}
      style={{
        textAlign: 'left',
        borderRadius: 18,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
        contentVisibility: 'auto',
        containIntrinsicHeight: 174,
        opacity: disabled ? 0.7 : 1,
        cursor: disabled ? 'default' : 'pointer',
      } as React.CSSProperties}
    >
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap: 2,
        height: 120,
        overflow: 'hidden',
        background: '#f2f4f6',
      }}>
        {visible ? scene.photoIds.slice(0, 4).map((pid, pi) => (
          <div key={pid} style={{ overflow: 'hidden', position: 'relative' }}>
            {thumbs[pid] ? (
              <img
                src={thumbs[pid]}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div className="shimmer-box" />
            )}
            {pi === 3 && scene.photoCount > 4 && (
              <div style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
              }}>
                +{scene.photoCount - 4}
              </div>
            )}
          </div>
        )) : (
          Array.from({ length: Math.min(cols, scene.photoCount) }, (_, i) => (
            <div key={i} className="shimmer-box" />
          ))
        )}
      </div>

      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, color: '#191f28', marginBottom: 4 }}>
            장면 {index + 1}
          </p>
          <p style={{ fontSize: 13, color: '#8b95a1' }}>
            {scene.photoCount}장의 사진
          </p>
        </div>
        <div style={{
          background: ctaBg,
          color: '#fff',
          borderRadius: 10,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
          transition: 'background 0.2s',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          {!effectiveUnlocked && adReady && (
            <span style={{ fontSize: 11, opacity: 0.85 }}>AD</span>
          )}
          {ctaLabel}
        </div>
      </div>
    </button>
  );
});

export default function SceneOverview() {
  const navigate = useNavigate();
  const result = quickScanStore.getResult();
  const premium = entitlementStore.isPremium();
  const [adState, setAdState] = useState<AdState>(adStore.getAdState());
  const [adError, setAdError] = useState(false);

  useEffect(() => {
    if (!result) { navigate('/', { replace: true }); return; }
  }, [result, navigate]);

  useEffect(() => {
    if (premium) return;
    adStore.preloadAd();
    return adStore.subscribe((state) => {
      setAdState(state);
      if (state === 'failed') setAdError(true);
    });
  }, [premium]);

  const handleAnalyze = useCallback(async (sceneId: string) => {
    if (premium || adStore.isSceneUnlocked(sceneId)) {
      navigate(`/deep-analysis/${sceneId}`);
      return;
    }

    if (adStore.getAdState() === 'ready') {
      const success = await adStore.showAd(sceneId);
      if (success) {
        navigate(`/deep-analysis/${sceneId}`);
      }
      return;
    }

    if (adStore.getAdState() === 'failed' || adStore.getAdState() === 'idle') {
      setAdError(false);
      adStore.preloadAd();
    }
  }, [navigate, premium]);

  const handleAnalyzeAll = useCallback(async () => {
    if (premium || adStore.isSceneUnlocked('all')) {
      navigate('/deep-analysis/all');
      return;
    }

    if (adStore.getAdState() === 'ready') {
      const success = await adStore.showAd('all');
      if (success) {
        navigate('/deep-analysis/all');
      }
      return;
    }

    if (adStore.getAdState() === 'failed' || adStore.getAdState() === 'idle') {
      setAdError(false);
      adStore.preloadAd();
    }
  }, [navigate, premium]);

  if (!result) return null;

  const totalPhotos = result.totalCount;
  const scanTime = (result.processingTimeMs / 1000).toFixed(1);
  const allUnlocked = premium || adStore.isSceneUnlocked('all');
  const allAdReady = adState === 'ready' || allUnlocked;
  const allAdLoading = !premium && adState === 'preloading';

  return (
    <div className="page">
      {/* Ad error toast */}
      {!premium && adError && adState === 'failed' && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#ff6b6b', color: '#fff', borderRadius: 12, padding: '10px 20px',
          fontSize: 13, fontWeight: 600, zIndex: 1000, boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          animation: 'fadeUp 0.3s ease', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>광고를 불러오지 못했어요</span>
          <button
            onClick={() => { setAdError(false); adStore.preloadAd(); }}
            style={{ background: 'rgba(255,255,255,0.3)', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, color: '#fff' }}
          >
            다시 시도
          </button>
        </div>
      )}

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>
            장면 분류 완료
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {premium && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6b4eff', background: '#f0ebff', borderRadius: 6, padding: '2px 8px' }}>
                프리미엄
              </span>
            )}
            <span style={{ fontSize: 12, color: '#8b95a1' }}>
              {scanTime}초 · {totalPhotos}장
            </span>
          </div>
        </div>
      </div>

      <div className="page-body" style={{ gap: 16, paddingTop: 8, paddingBottom: 80 }}>
        <p style={{ fontSize: 14, color: '#8b95a1', lineHeight: 1.5 }}>
          {totalPhotos}장에서 {result.sceneCount}개 장면을 찾았어요.
          <br />
          {premium
            ? '베스트컷을 찾고 싶은 장면을 선택하세요.'
            : '베스트컷을 찾으려면 장면을 선택하세요.'
          }
        </p>

        {/* Free user: explain the ad flow clearly */}
        {!premium && (
          <div style={{
            background: '#f8f9fa', borderRadius: 12, padding: '12px 14px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{ fontSize: 14, marginTop: 1 }}>ℹ️</span>
            <p style={{ fontSize: 13, color: '#6b7684', lineHeight: 1.5 }}>
              여기까지는 무료예요.
              베스트컷 분석은 짧은 광고 시청 후 시작돼요.
            </p>
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: '전체', value: totalPhotos, unit: '장', color: '#3182f6', bg: '#e8f3ff' },
            { label: '장면', value: result.sceneCount, unit: '개', color: '#6b4eff', bg: '#f0ebff' },
            { label: '스캔', value: scanTime, unit: '초', color: '#00b894', bg: '#e6f7f2' },
          ].map((s) => (
            <div
              key={s.label}
              style={{
                flex: 1,
                background: s.bg,
                borderRadius: 14,
                padding: '12px 0',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: 11, color: '#6b7684', marginBottom: 3 }}>{s.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>
                {s.value}
                <span style={{ fontSize: 11, fontWeight: 500, marginLeft: 1 }}>{s.unit}</span>
              </p>
            </div>
          ))}
        </div>

        {/* Scene list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.scenes.map((scene, i) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={i}
              premium={premium}
              adState={adState}
              unlocked={adStore.isSceneUnlocked(scene.id)}
              onAnalyze={handleAnalyze}
            />
          ))}
        </div>

        {/* Tip */}
        <div style={{ background: '#f2f4f6', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>💡</span>
          <p style={{ fontSize: 13, color: '#6b7684', lineHeight: 1.5 }}>
            장면을 선택하면 얼굴 인식, 화질 평가를 거쳐
            베스트컷을 골라드려요.
          </p>
        </div>

        {/* Free user upsell — soft, informational */}
        {!premium && (
          <button
            onClick={() => navigate('/premium')}
            style={{
              background: '#fff', border: '1px solid #e5e8eb',
              borderRadius: 14, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
              textAlign: 'left',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: '#f0ebff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>
              ✨
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#191f28', marginBottom: 2 }}>
                광고 없이 바로 분석하기
              </p>
              <p style={{ fontSize: 12, color: '#8b95a1' }}>
                프리미엄 · 월 ₩3,900
              </p>
            </div>
            <span style={{ fontSize: 13, color: '#adb5bd' }}>›</span>
          </button>
        )}
      </div>

      <div className="page-footer" style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn-secondary"
          style={{ flex: 1 }}
          onClick={() => navigate('/upload')}
        >
          다시 선택
        </button>
        <button
          className="btn-primary"
          style={{
            flex: 2,
            opacity: (allAdLoading || adState === 'showing') ? 0.6 : 1,
          }}
          onClick={handleAnalyzeAll}
          disabled={allAdLoading || adState === 'showing'}
        >
          {allUnlocked
            ? `전체 베스트컷 찾기 (${totalPhotos}장)`
            : allAdReady
              ? `AD 전체 베스트컷 찾기 (${totalPhotos}장)`
              : allAdLoading
                ? '준비 중...'
                : `전체 베스트컷 찾기 (${totalPhotos}장)`
          }
        </button>
      </div>
    </div>
  );
}
