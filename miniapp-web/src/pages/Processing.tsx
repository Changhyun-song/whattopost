import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as fileStore from '../lib/fileStore';
import * as quickScanStore from '../lib/quickScanStore';
import { runQuickScan, type QuickScanProgress } from '../lib/mockAnalysis';

const STEPS = [
  { label: '스캔', icon: '📷' },
  { label: '분류', icon: '📂' },
];

export default function Processing() {
  const navigate = useNavigate();
  const totalCount = fileStore.getCount();
  const doneRef = useRef(false);

  const [progress, setProgress] = useState<QuickScanProgress>({
    stage: 0,
    stageLabel: '준비 중이에요',
    stageDetail: '',
    overallProgress: 0,
    processedCount: 0,
    sceneCount: 0,
  });

  const [showComplete, setShowComplete] = useState(false);

  useEffect(() => {
    if (totalCount === 0) {
      navigate('/', { replace: true });
      return;
    }

    let cancelled = false;

    runQuickScan(fileStore.getManifest(), (update) => {
      if (!cancelled) setProgress(update);
    }).then((result) => {
      if (cancelled || doneRef.current) return;
      doneRef.current = true;
      quickScanStore.setResult(result);

      setProgress((prev) => ({ ...prev, overallProgress: 100, stageLabel: '정리 완료!', stageDetail: '장면을 확인해보세요' }));
      setShowComplete(true);

      setTimeout(() => {
        if (!cancelled) navigate('/scenes', { replace: true });
      }, 600);
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
          background: showComplete ? '#00b894' : 'linear-gradient(90deg, #3182f6, #6b4eff)',
          width: `${pct}%`,
          transition: 'width 0.4s ease, background 0.3s',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      <div style={{ textAlign: 'center', padding: '0 24px', animation: 'fadeUp 0.4s ease', maxWidth: 400, width: '100%' }}>
        <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto 24px' }}>
          <svg viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)', width: 140, height: 140 }}>
            <circle cx="70" cy="70" r="60" fill="none" stroke="#f2f4f6" strokeWidth="8" />
            <circle
              cx="70" cy="70" r="60" fill="none"
              stroke={showComplete ? '#00b894' : '#3182f6'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 60}`}
              strokeDashoffset={`${2 * Math.PI * 60 * (1 - pct / 100)}`}
              style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s' }}
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: showComplete ? '#00b894' : '#3182f6', letterSpacing: -2, fontVariantNumeric: 'tabular-nums' }}>
              {pct}
            </span>
            <span style={{ fontSize: 12, color: '#8b95a1', fontWeight: 500, marginTop: -2 }}>%</span>
          </div>
        </div>

        <p style={{ fontSize: 18, fontWeight: 700, letterSpacing: -0.3, color: showComplete ? '#00b894' : '#191f28', transition: 'color 0.3s' }}>
          {progress.stageLabel}
        </p>
        <p style={{ fontSize: 13, color: '#8b95a1', marginTop: 6, minHeight: 20, transition: 'opacity 0.2s' }}>
          {progress.stageDetail}
        </p>

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
                  background: done ? '#00b894' : active ? '#3182f6' : '#f2f4f6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                  transition: 'background 0.3s',
                  boxShadow: active ? '0 2px 12px rgba(49,130,246,0.3)' : 'none',
                }}>
                  {done ? <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>✓</span> : step.icon}
                </div>
                <span style={{
                  fontSize: 11, fontWeight: active || done ? 600 : 400,
                  color: done ? '#00b894' : active ? '#3182f6' : '#adb5bd',
                  transition: 'color 0.3s',
                }}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 32 }}>
          {[
            { label: '전체', value: totalCount, unit: '장' },
            { label: '스캔', value: progress.processedCount, unit: '장' },
            { label: '장면', value: progress.sceneCount, unit: '개' },
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

        <p style={{ fontSize: 12, color: '#adb5bd', marginTop: 24 }}>
          얼굴 분석 없이 장면만 빠르게 구분해요
        </p>
      </div>
    </div>
  );
}
