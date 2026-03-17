import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as fileStore from '../lib/fileStore';
import * as previewQueue from '../lib/previewQueue';
import * as analysisStore from '../lib/analysisStore';
import * as quickScanStore from '../lib/quickScanStore';

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    fileStore.clear();
    previewQueue.revokeAll();
    analysisStore.clear();
    quickScanStore.clear();
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
          같은 사진만 30장?
          <br />
          프사 후보, 여기서 끝
        </p>

        <div
          style={{
            display: 'flex',
            gap: 20,
            marginTop: 36,
            color: '#adb5bd',
            fontSize: 13,
          }}
        >
          {['사진 선택', '자동 분석', '베스트컷'].map((step, i) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                {i + 1}
              </span>
              {step}
            </div>
          ))}
        </div>
      </div>

      <div className="page-footer">
        <button className="btn-primary" onClick={() => navigate('/upload')}>
          사진 고르기 시작
        </button>
      </div>
    </div>
  );
}
