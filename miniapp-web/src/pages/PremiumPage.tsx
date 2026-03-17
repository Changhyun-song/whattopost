import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as entitlementStore from '../lib/entitlementStore';
import type { PurchaseState, ProductInfo } from '../lib/entitlementStore';

const FEATURES = [
  { icon: '📸', label: '사진 최대 1,000장', desc: '한 번에 더 많은 사진을 올려 분석할 수 있어요' },
  { icon: '⚡', label: '광고 없이 바로 분석', desc: '장면을 선택하면 대기 없이 베스트컷 분석 시작' },
  { icon: '🔓', label: '모든 장면 자유롭게', desc: '원하는 장면을 제한 없이 분석할 수 있어요' },
];

export default function PremiumPage() {
  const navigate = useNavigate();
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [purchaseState, setPurchaseState] = useState<PurchaseState>(entitlementStore.getPurchaseState());
  const [error, setError] = useState<string | null>(null);
  const premium = entitlementStore.isPremium();

  useEffect(() => {
    entitlementStore.loadProducts().then((products) => {
      if (products.length > 0) setProduct(products[0]);
    });
    return entitlementStore.subscribe(() => {
      setPurchaseState(entitlementStore.getPurchaseState());
      setError(entitlementStore.getPurchaseError());
    });
  }, []);

  const handlePurchase = async () => {
    setError(null);
    const success = await entitlementStore.purchasePremium();
    if (success) {
      setTimeout(() => navigate(-1), 1200);
    }
  };

  const handleRestore = async () => {
    setError(null);
    const restored = await entitlementStore.restorePurchases();
    if (restored) {
      setTimeout(() => navigate(-1), 800);
    } else {
      setError('복원할 구독을 찾을 수 없어요');
      setTimeout(() => setError(null), 3000);
    }
  };

  const purchasing = purchaseState === 'purchasing';
  const restoring = purchaseState === 'restoring';
  const loading = purchaseState === 'loading_products';
  const succeeded = purchaseState === 'success' || premium;
  const cancelled = purchaseState === 'cancelled';

  return (
    <div className="page" style={{ background: '#fafbfc' }}>
      {/* Error/cancel toast */}
      {(error || cancelled) && (
        <div style={{
          position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: cancelled ? '#6b7684' : '#ff6b6b', color: '#fff', borderRadius: 12,
          padding: '10px 20px', fontSize: 13, fontWeight: 600, zIndex: 1000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', animation: 'fadeUp 0.3s ease',
        }}>
          {cancelled ? '결제를 취소했어요' : error}
        </div>
      )}

      {/* Success overlay */}
      {succeeded && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.95)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, animation: 'fadeUp 0.4s ease',
        }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
          <p style={{ fontSize: 20, fontWeight: 700, color: '#191f28', marginBottom: 8 }}>
            프리미엄이 시작됐어요!
          </p>
          <p style={{ fontSize: 14, color: '#8b95a1', lineHeight: 1.5 }}>
            이제 광고 없이 바로 분석하고,
            <br />
            최대 1,000장까지 올릴 수 있어요
          </p>
        </div>
      )}

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate(-1)}
            style={{ fontSize: 18, color: '#191f28', padding: '4px 0' }}
          >
            ←
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.3 }}>
            프리미엄
          </h1>
        </div>
      </div>

      <div className="page-body" style={{ gap: 20, paddingTop: 8, paddingBottom: 100 }}>
        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg, #6b4eff 0%, #3182f6 100%)',
          borderRadius: 20, padding: '28px 24px', color: '#fff', textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>
            프리미엄 구독
          </p>
          <p style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1, marginBottom: 6 }}>
            월 {product?.price ?? '₩3,900'}
          </p>
          <p style={{ fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
            광고 없이, 더 많은 사진을
            <br />
            언제든 해지할 수 있어요
          </p>
        </div>

        {/* Features */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {FEATURES.map((f) => (
            <div
              key={f.label}
              style={{
                background: '#fff', borderRadius: 16, padding: '16px 18px',
                display: 'flex', alignItems: 'center', gap: 14,
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              <span style={{ fontSize: 24 }}>{f.icon}</span>
              <div>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#191f28', marginBottom: 2 }}>
                  {f.label}
                </p>
                <p style={{ fontSize: 13, color: '#8b95a1' }}>
                  {f.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '12px 16px', background: '#f8f9fa', borderBottom: '1px solid #f2f4f6' }}>
            <span style={{ fontSize: 12, color: '#8b95a1', fontWeight: 600 }}></span>
            <span style={{ fontSize: 12, color: '#8b95a1', fontWeight: 600, textAlign: 'center' }}>무료</span>
            <span style={{ fontSize: 12, color: '#6b4eff', fontWeight: 700, textAlign: 'center' }}>프리미엄</span>
          </div>
          {[
            { label: '사진 업로드', free: '최대 30장', prem: '최대 1,000장' },
            { label: '장면 분류', free: '무료', prem: '무료' },
            { label: '베스트컷 분석', free: '광고 시청 후', prem: '바로 분석' },
            { label: '광고', free: '있음', prem: '없음' },
          ].map((row, i) => (
            <div
              key={row.label}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '12px 16px',
                borderBottom: i < 3 ? '1px solid #f2f4f6' : 'none',
              }}
            >
              <span style={{ fontSize: 13, color: '#191f28' }}>{row.label}</span>
              <span style={{ fontSize: 13, color: '#8b95a1', textAlign: 'center' }}>{row.free}</span>
              <span style={{ fontSize: 13, color: '#6b4eff', fontWeight: 600, textAlign: 'center' }}>{row.prem}</span>
            </div>
          ))}
        </div>

        {/* Restore link */}
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={handleRestore}
            disabled={restoring}
            style={{ fontSize: 13, color: '#8b95a1', textDecoration: 'underline', padding: '8px 16px' }}
          >
            {restoring ? '구독 복원 중...' : '이미 구독 중이신가요? 복원하기'}
          </button>
        </div>

        {/* Notice */}
        <div style={{ fontSize: 11, color: '#adb5bd', lineHeight: 1.7, textAlign: 'center', padding: '0 12px' }}>
          <p>구독은 결제일로부터 1개월간 유효합니다.</p>
          <p>기간 내 언제든 해지할 수 있으며,</p>
          <p>해지 후에도 남은 기간 동안 혜택이 유지됩니다.</p>
          <p style={{ marginTop: 6 }}>결제 관련 문의: 토스 앱 내 고객센터</p>
        </div>
      </div>

      <div className="page-footer">
        <button
          className="btn-primary"
          onClick={handlePurchase}
          disabled={purchasing || loading || succeeded}
          style={{
            background: succeeded ? '#00b894' : purchasing ? '#adb5bd' : 'linear-gradient(135deg, #6b4eff, #3182f6)',
            transition: 'background 0.3s',
          }}
        >
          {succeeded
            ? '프리미엄 이용 중'
            : purchasing
              ? '결제 진행 중...'
              : loading
                ? '준비 중...'
                : `월 ${product?.price ?? '₩3,900'}으로 시작하기`
          }
        </button>
      </div>
    </div>
  );
}
