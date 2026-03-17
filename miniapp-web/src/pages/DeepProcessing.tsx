import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as fileStore from '../lib/fileStore';
import * as analysisStore from '../lib/analysisStore';
import * as quickScanStore from '../lib/quickScanStore';
import * as adStore from '../lib/adStore';
import { runAnalysis, type ProgressUpdate } from '../lib/mockAnalysis';

const STEPS = [
  { label: '준비', icon: '🔧' },
  { label: '분석', icon: '🔍' },
  { label: '분류', icon: '📂' },
  { label: '평가', icon: '⭐' },
];

export default function DeepProcessing() {
  const navigate = useNavigate();
  const { sceneId } = useParams<{ sceneId: string }>();
  const doneRef = useRef(false);

  const quickResult = quickScanStore.getResult();

  const targetManifest = (() => {
    const fullManifest = fileStore.getManifest();
    if (!sceneId || sceneId === 'all') return fullManifest;
    if (!quickResult) return fullManifest;

    const scene = quickResult.scenes.find((s) => s.id === sceneId);
    if (!scene) return fullManifest;

    const idSet = new Set(scene.photoIds);
    return fullManifest.filter((e) => idSet.has(e.id));
  })();

  const totalCount = targetManifest.length;
  const sceneName = sceneId === 'all'
    ? '전체'
    : quickResult?.scenes.find((s) => s.id === sceneId)
      ? `장면 ${quickResult.scenes.findIndex((s) => s.id === sceneId) + 1}`
      : '선택된 장면';

  const [progress, setProgress] = useState<ProgressUpdate>({
    stage: 0,
    stageLabel: '준비 중이에요',
    stageDetail: '',
    overallProgress: 0,
    processedCount: 0,
    groupCount: 0,
  });

  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    if (totalCount === 0) {
      navigate('/', { replace: true });
      return;
    }

    // Guard: scene must be unlocked via rewarded ad before analysis starts.
    // Prevents direct URL navigation bypassing the ad gate.
    const targetScene = sceneId || 'all';
    if (!adStore.isSceneUnlocked(targetScene)) {
      console.warn(`[deep] scene "${targetScene}" not unlocked — redirecting to /scenes`);
      navigate('/scenes', { replace: true });
      return;
    }

    let cancelled = false;

    analysisStore.clear();

    runAnalysis(targetManifest, (update) => {
      if (!cancelled) setProgress(update);
    }).then((result) => {
      if (cancelled || doneRef.current) return;
      doneRef.current = true;
      analysisStore.setResult(result);

      setProgress((prev) => ({ ...prev, overallProgress: 100, stageLabel: '완료!', stageDetail: '결과를 보여드릴게요' }));
      setShowComplete(true);

      setTimeout(() => {
        if (!cancelled) navigate('/result', { replace: true });
      }, 800);
    });

    return () => { cancelled = true; };
  }, [navigate, totalCount]);

  const pct = progress.overallProgress;
  const currentStage = Math.min(progress.stage, STEPS.length - 1);

  return (
    <div className="page" style={{ justifyContent: 'center', alignItems: 'center', minHeight: '100dvh' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 4, background: '#e5e8eb', zIndex: 100 }}>
        <div style={{
          height: '100%',
          background: showComplete ? '#00b894' : 'linear-gradient(90deg, #6b4eff, #3182f6)',
          width: `${pct}%`,
          transition: 'width 0.4s ease, background 0.3s',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      <div style={{ textAlign: 'center', padding: '0 24px', animation: 'fadeUp 0.4s ease', maxWidth: 400, width: '100%' }}>
        {/* Scene badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: '#f0ebff',
          borderRadius: 20,
          padding: '6px 14px',
          marginBottom: 20,
          fontSize: 13,
          fontWeight: 600,
          color: '#6b4eff',
        }}>
          <span>🔬</span> {sceneName} · {totalCount}장 정밀 분석
        </div>

        {/* Circular progress */}
        <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto 24px' }}>
          <svg viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)', width: 140, height: 140 }}>
            <circle cx="70" cy="70" r="60" fill="none" stroke="#f2f4f6" strokeWidth="8" />
            <circle
              cx="70" cy="70" r="60" fill="none"
              stroke={showComplete ? '#00b894' : '#6b4eff'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 60}`}
              strokeDashoffset={`${2 * Math.PI * 60 * (1 - pct / 100)}`}
              style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: showComplete ? '#00b894' : '#6b4eff', letterSpacing: -2, fontVariantNumeric: 'tabular-nums' }}>
              {pct}
            </span>
            <span style={{ fontSize: 12, color: '#8b95a1', fontWeight: 500, marginTop: -2 }}>%</span>
          </div>
        </div>

        {/* Stage label */}
        <p style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: showComplete ? '#00b894' : '#191f28', transition: 'color 0.3s' }}>
          {progress.stageLabel}
        </p>
        <p style={{ fontSize: 13, color: '#8b95a1', marginTop: 6, minHeight: 20, transition: 'opacity 0.2s' }}>
          {progress.stageDetail}
        </p>

        {/* Step indicators */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 32 }}>
          {STEPS.map((step, i) => {
            const done = i < currentStage || showComplete;
            const active = i === currentStage && !showComplete;
            return (
              <div
                key={i}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  flex: 1, maxWidth: 72,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: done ? '#00b894' : active ? '#6b4eff' : '#f2f4f6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                  transition: 'background 0.3s',
                  boxShadow: active ? '0 2px 12px rgba(107,78,255,0.3)' : 'none',
                }}>
                  {done ? <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>✓</span> : step.icon}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: active || done ? 600 : 400,
                  color: done ? '#00b894' : active ? '#6b4eff' : '#adb5bd',
                  transition: 'color 0.3s',
                }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Live stats */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 32 }}>
          {[
            { label: '대상', value: totalCount, unit: '장' },
            { label: '분석', value: progress.processedCount, unit: '장' },
            { label: '그룹', value: progress.groupCount, unit: '개' },
          ].map((stat) => (
            <div
              key={stat.label}
              style={{
                background: '#f8f9fa', borderRadius: 14, padding: '12px 16px',
                minWidth: 80, textAlign: 'center',
              }}
            >
              <p style={{ fontSize: 11, color: '#8b95a1', marginBottom: 3 }}>{stat.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: '#191f28', fontVariantNumeric: 'tabular-nums' }}>
                {stat.value}
                <span style={{ fontSize: 11, fontWeight: 400, color: '#8b95a1', marginLeft: 2 }}>{stat.unit}</span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
