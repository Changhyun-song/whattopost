import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as fileStore from '../lib/fileStore';
import * as previewQueue from '../lib/previewQueue';
import * as analysisStore from '../lib/analysisStore';
import * as quickScanStore from '../lib/quickScanStore';
import * as adStore from '../lib/adStore';
import * as entitlementStore from '../lib/entitlementStore';

export default function Home() {
  const navigate = useNavigate();
  const [premium, setPremium] = useState(entitlementStore.isPremium());

  useEffect(() => {
    fileStore.clear();
    previewQueue.revokeAll();
    analysisStore.clear();
    quickScanStore.clear();
    adStore.clearUnlocks();

    entitlementStore.restorePurchases().then(() => {
      setPremium(entitlementStore.isPremium());
    });

    return entitlementStore.subscribe(() => {
      setPremium(entitlementStore.isPremium());
    });
  }, []);

  return (
    <div className="page">
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          paddingBottom: 80,
          animation: 'fadeUp 0.5s ease',
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: 28,
            background: '#f2f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 44,
            marginBottom: 28,
          }}
        >
          📸
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>
          뭐 올리지?
        </h1>

        <p
          style={{
            fontSize: 15,
            color: '#8b95a1',
            marginTop: 10,
            textAlign: 'center',
            lineHeight: 1.6,
            letterSpacing: -0.2,
          }}
        >
          비슷한 사진 중 베스트컷,
          <br />
          AI가 골라드려요
        </p>

        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 32,
            color: '#adb5bd',
            fontSize: 13,
          }}
        >
          {[
            { num: '1', label: '사진 선택' },
            { num: '2', label: '장면 분류' },
            { num: '3', label: '베스트컷' },
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#f2f4f6',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#8b95a1',
                }}
              >
                {step.num}
              </span>
              {step.label}
              {i < 2 && <span style={{ color: '#e5e8eb', margin: '0 2px' }}>›</span>}
            </div>
          ))}
        </div>

        {!premium && (
          <p style={{ fontSize: 12, color: '#adb5bd', marginTop: 16, textAlign: 'center', lineHeight: 1.5 }}>
            무료로 {entitlementStore.getPhotoLimit()}장까지 · 장면 분류 무료
            <br />
            베스트컷 분석은 짧은 광고 시청 후 이용
          </p>
        )}
      </div>

      <div className="page-footer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn-primary" onClick={() => navigate('/upload')}>
          사진 고르기 시작
        </button>
        {premium ? (
          <p style={{ fontSize: 12, color: '#6b4eff', textAlign: 'center', fontWeight: 600 }}>
            프리미엄 · 광고 없이 1,000장까지
          </p>
        ) : (
          <button
            onClick={() => navigate('/premium')}
            style={{ fontSize: 13, color: '#8b95a1', padding: '10px 0', textAlign: 'center' }}
          >
            광고 없이 쓰고 싶다면 <span style={{ color: '#6b4eff', fontWeight: 600 }}>프리미엄</span>
          </button>
        )}
      </div>
    </div>
  );
}
