/**
 * Entitlement & IAP store for Toss MiniApp.
 *
 * 출시 1차: 월 구독 1종 (premium_subscription)
 * 추후 확장: 토큰/크레딧팩은 Entitlement.extras 필드로 확장 가능
 *
 * ── Toss MiniApp IAP 연동 ──
 * 실제 연동 시 @tosspayments/tosspayments-sdk 또는
 * Toss MiniApp SDK의 IAP API로 교체합니다.
 * - getProducts(): 상품 목록 조회
 * - purchase(): 구매 요청
 * - restorePurchases(): 구매 복원 (앱 재설치/재진입)
 *
 * 샌드박스에서는 IAP가 동작하지 않으므로 QR 실기기 테스트가 필수입니다.
 */

// ── Types ──

export type PlanType = 'free' | 'premium_subscription';

export type PurchaseState =
  | 'idle'
  | 'loading_products'
  | 'products_ready'
  | 'purchasing'
  | 'restoring'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'pending';

export interface ProductInfo {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
}

export interface Entitlement {
  plan: PlanType;
  photoLimit: number;
  adFree: boolean;
  sceneAnalysisLimit: number; // -1 = unlimited
  expiresAt: number | null; // epoch ms, null = no expiry (free)
  /** Reserved for future token/credit system */
  extras: Record<string, unknown>;
}

interface EntitlementStoreState {
  entitlement: Entitlement;
  purchaseState: PurchaseState;
  purchaseError: string | null;
  products: ProductInfo[];
}

// ── Plan configs ──

const FREE_ENTITLEMENT: Entitlement = {
  plan: 'free',
  photoLimit: 30,
  adFree: false,
  sceneAnalysisLimit: -1,
  expiresAt: null,
  extras: {},
};

const PREMIUM_ENTITLEMENT: Entitlement = {
  plan: 'premium_subscription',
  photoLimit: 1000,
  adFree: true,
  sceneAnalysisLimit: -1,
  expiresAt: null, // set on purchase
  extras: {},
};

// ── Product catalog ──

const MONTHLY_PRODUCT: ProductInfo = {
  id: 'whattopost_premium_monthly',
  name: '뭐 올리지? 프리미엄',
  price: '₩3,900',
  period: '월',
  description: '사진 1,000장 분석 · 광고 없음 · 무제한 베스트컷',
};

// ── Store singleton ──

const DEV_MODE = import.meta.env.DEV;
const STORAGE_KEY = 'whattopost_entitlement';

function loadPersistedEntitlement(): Entitlement {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return FREE_ENTITLEMENT;
    const parsed = JSON.parse(raw) as Entitlement;

    if (parsed.plan === 'premium_subscription') {
      if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
        console.log('[entitlement] subscription expired, falling back to free');
        localStorage.removeItem(STORAGE_KEY);
        return FREE_ENTITLEMENT;
      }
      return parsed;
    }
    return FREE_ENTITLEMENT;
  } catch {
    return FREE_ENTITLEMENT;
  }
}

function persistEntitlement(e: Entitlement) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(e));
  } catch {
    console.warn('[entitlement] failed to persist');
  }
}

const store: EntitlementStoreState = {
  entitlement: loadPersistedEntitlement(),
  purchaseState: 'idle',
  purchaseError: null,
  products: [],
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn();
}

// ── Public API: queries ──

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getEntitlement(): Entitlement {
  return store.entitlement;
}

export function isPremium(): boolean {
  return store.entitlement.plan === 'premium_subscription';
}

export function getPhotoLimit(): number {
  return store.entitlement.photoLimit;
}

export function isAdFree(): boolean {
  return store.entitlement.adFree;
}

export function getPurchaseState(): PurchaseState {
  return store.purchaseState;
}

export function getPurchaseError(): string | null {
  return store.purchaseError;
}

export function getProducts(): ProductInfo[] {
  return store.products;
}

// ── Public API: actions ──

/**
 * Load available IAP products from the store.
 * Call on paywall mount.
 */
export async function loadProducts(): Promise<ProductInfo[]> {
  store.purchaseState = 'loading_products';
  store.purchaseError = null;
  notify();

  try {
    // TODO: Replace with actual Toss MiniApp IAP product query
    // Example:
    //   import { getProductList } from '@apps-in-toss/iap';
    //   const products = await getProductList(['whattopost_premium_monthly']);
    //
    // 샌드박스에서는 이 호출이 실패합니다. QR 테스트 필수.

    if (DEV_MODE) {
      await new Promise((r) => setTimeout(r, 300));
    }

    store.products = [MONTHLY_PRODUCT];
    store.purchaseState = 'products_ready';
    notify();
    return store.products;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.purchaseState = 'failed';
    store.purchaseError = msg;
    console.error('[entitlement] loadProducts failed:', msg);
    notify();
    return [];
  }
}

/**
 * Purchase the monthly premium subscription.
 */
export async function purchasePremium(): Promise<boolean> {
  if (store.purchaseState === 'purchasing') return false;

  store.purchaseState = 'purchasing';
  store.purchaseError = null;
  notify();

  try {
    // TODO: Replace with actual Toss MiniApp IAP purchase
    // Example:
    //   import { purchaseSubscription } from '@apps-in-toss/iap';
    //   const receipt = await purchaseSubscription({
    //     productId: 'whattopost_premium_monthly',
    //   });
    //   if (receipt.status === 'cancelled') throw new PurchaseCancelledError();
    //   if (receipt.status === 'pending') { handlePending(receipt); return false; }
    //   // Validate receipt server-side if backend exists
    //
    // 샌드박스에서는 이 호출이 실패합니다.

    if (DEV_MODE) {
      console.log('[entitlement] DEV mode — simulating purchase success');
      await new Promise((r) => setTimeout(r, 600));
    }

    const now = Date.now();
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    const entitlement: Entitlement = {
      ...PREMIUM_ENTITLEMENT,
      expiresAt: now + oneMonth,
    };

    store.entitlement = entitlement;
    store.purchaseState = 'success';
    store.purchaseError = null;
    persistEntitlement(entitlement);
    console.log('[entitlement] premium activated, expires:', new Date(entitlement.expiresAt!).toISOString());
    notify();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isCancelled = msg.includes('cancel') || msg.includes('취소');
    store.purchaseState = isCancelled ? 'cancelled' : 'failed';
    store.purchaseError = isCancelled ? null : msg;
    console.warn(`[entitlement] purchase ${isCancelled ? 'cancelled' : 'failed'}:`, msg);
    notify();
    return false;
  }
}

/**
 * Restore purchases (app re-entry, reinstall).
 * Call on app init (Home mount) to recover premium state.
 */
export async function restorePurchases(): Promise<boolean> {
  // First check localStorage
  const persisted = loadPersistedEntitlement();
  if (persisted.plan === 'premium_subscription') {
    store.entitlement = persisted;
    notify();
    console.log('[entitlement] restored from local storage');
    return true;
  }

  store.purchaseState = 'restoring';
  notify();

  try {
    // TODO: Replace with actual Toss MiniApp IAP restore
    // Example:
    //   import { restorePurchases as iapRestore } from '@apps-in-toss/iap';
    //   const purchases = await iapRestore();
    //   const sub = purchases.find(p => p.productId === 'whattopost_premium_monthly' && p.isActive);
    //   if (sub) { activatePremium(sub.expiresAt); return true; }
    //
    // 서버가 있다면: /api/entitlement?userId=... 로 서버 검증 가능
    // 서버가 없다면: IAP SDK의 restorePurchases 결과를 신뢰

    if (DEV_MODE) {
      await new Promise((r) => setTimeout(r, 200));
    }

    store.purchaseState = 'idle';
    notify();
    return false;
  } catch (err) {
    console.warn('[entitlement] restore failed:', err);
    store.purchaseState = 'idle';
    notify();
    return false;
  }
}

/**
 * Force-set entitlement (for testing / server-side validation callback).
 */
export function _setEntitlement(e: Entitlement): void {
  store.entitlement = e;
  persistEntitlement(e);
  notify();
}

/**
 * Reset to free plan (for testing / subscription expiry).
 */
export function resetToFree(): void {
  store.entitlement = FREE_ENTITLEMENT;
  store.purchaseState = 'idle';
  store.purchaseError = null;
  localStorage.removeItem(STORAGE_KEY);
  notify();
}
