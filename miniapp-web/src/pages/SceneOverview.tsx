import { useEffect, useState, useRef, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as quickScanStore from '../lib/quickScanStore';
import * as previewQueue from '../lib/previewQueue';
import type { QuickScanScene } from '../lib/mockAnalysis';

// Per-card component — isolates re-renders to individual cards
const SceneCard = memo(function SceneCard({
  scene,
  index,
  onAnalyze,
}: {
  scene: QuickScanScene;
  index: number;
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

  return (
    <button
      ref={cardRef}
      onClick={() => onAnalyze(scene.id)}
      style={{
        textAlign: 'left',
        borderRadius: 18,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 1px 8px rgba(0,0,0,0.06)',
        contentVisibility: 'auto',
        containIntrinsicHeight: 174,
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
          background: '#3182f6',
          color: '#fff',
          borderRadius: 10,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
        }}>
          분석하기
        </div>
      </div>
    </button>
  );
});

export default function SceneOverview() {
  const navigate = useNavigate();
  const result = quickScanStore.getResult();

  useEffect(() => {
    if (!result) navigate('/', { replace: true });
  }, [result, navigate]);

  const handleAnalyze = useCallback((sceneId: string) => {
    navigate(`/deep-analysis/${sceneId}`);
  }, [navigate]);

  if (!result) return null;

  const totalPhotos = result.totalCount;
  const scanTime = (result.processingTimeMs / 1000).toFixed(1);

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>
            장면 분류
          </h1>
          <span style={{ fontSize: 12, color: '#8b95a1' }}>
            {scanTime}초 · {totalPhotos}장
          </span>
        </div>
      </div>

      <div className="page-body" style={{ gap: 16, paddingTop: 8, paddingBottom: 80 }}>
        <p style={{ fontSize: 14, color: '#8b95a1', lineHeight: 1.5 }}>
          {totalPhotos}장에서 {result.sceneCount}개 장면을 찾았어요.
          <br />
          분석하고 싶은 장면을 선택하세요.
        </p>

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

        {/* Scene list — each card lazy-loads its own previews */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {result.scenes.map((scene, i) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={i}
              onAnalyze={handleAnalyze}
            />
          ))}
        </div>

        {/* Tip */}
        <div style={{ background: '#f2f4f6', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>💡</span>
          <p style={{ fontSize: 13, color: '#6b7684', lineHeight: 1.5 }}>
            장면을 선택하면 해당 장면의 사진만 정밀 분석해요.
            얼굴 인식 + 화질 평가 + 베스트컷 선정까지!
          </p>
        </div>
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
          style={{ flex: 2 }}
          onClick={() => navigate('/deep-analysis/all')}
        >
          전체 분석하기 ({totalPhotos}장)
        </button>
      </div>
    </div>
  );
}
