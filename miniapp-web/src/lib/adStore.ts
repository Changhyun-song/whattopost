/**
 * Rewarded Ad state machine for Toss WebView MiniApp.
 *
 * States: idle → preloading → ready → showing → watched → (reset to idle)
 *                         └→ failed → (retry → preloading)
 *
 * Integration notes:
 * - Toss MiniApp SDK의 rewarded ad API를 사용합니다.
 * - 샌드박스(sandbox) 환경에서는 광고가 로드되지 않습니다.
 *   실제 테스트는 QR 코드로 실기기에서 진행해야 합니다.
 * - 개발 환경에서는 DEV_BYPASS가 true이면 광고 없이 바로 watched 상태로 전환됩니다.
 */

import * as entitlementStore from './entitlementStore';

export type AdState = 'idle' | 'preloading' | 'ready' | 'showing' | 'watched' | 'failed';

interface AdStoreState {
  state: AdState;
  error: string | null;
  /** Scene IDs that have already been unlocked via ad watch */
  unlockedScenes: Set<string>;
}

const store: AdStoreState = {
  state: 'idle',
  error: null,
  unlockedScenes: new Set(),
};

type Listener = (state: AdState) => void;
const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn(store.state);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAdState(): AdState {
  return store.state;
}

export function getAdError(): string | null {
  return store.error;
}

export function isSceneUnlocked(sceneId: string): boolean {
  if (entitlementStore.isAdFree()) return true;
  return store.unlockedScenes.has(sceneId) || store.unlockedScenes.has('all');
}

// ── DEV bypass: skip ads in development ──
// 샌드박스에서는 광고 로드가 불가하므로 개발 중에는 이 플래그로 우회합니다.
// 실제 QR 테스트 시에는 false로 설정하거나 production 빌드를 사용하세요.
const DEV_BYPASS = import.meta.env.DEV;

// ── Toss MiniApp Rewarded Ad API placeholders ──
// 실제 구현 시 @apps-in-toss/web-framework의 광고 API로 교체합니다.
// 테스트용 광고 ID: 'test-rewarded-ad-unit'
const AD_UNIT_ID = import.meta.env.VITE_AD_UNIT_ID || 'test-rewarded-ad-unit';

/**
 * Preload a rewarded ad so it's ready when the user clicks the CTA.
 * Call this early (e.g., when SceneOverview mounts) for minimal wait time.
 */
export async function preloadAd(): Promise<void> {
  if (store.state === 'ready' || store.state === 'preloading') return;

  if (DEV_BYPASS) {
    console.log('[ad] DEV bypass — skipping preload, marking ready');
    store.state = 'ready';
    store.error = null;
    notify();
    return;
  }

  store.state = 'preloading';
  store.error = null;
  notify();

  try {
    // TODO: Replace with actual Toss MiniApp SDK rewarded ad preload
    // Example:
    //   import { loadRewardedAd } from '@apps-in-toss/web-framework';
    //   await loadRewardedAd({ unitId: AD_UNIT_ID });
    //
    // 샌드박스에서는 이 호출이 실패합니다.
    // QR 테스트 또는 production에서만 정상 동작합니다.
    console.log(`[ad] preloading rewarded ad (unitId: ${AD_UNIT_ID})...`);

    // Simulated preload delay for development
    await new Promise((resolve) => setTimeout(resolve, 1500));

    store.state = 'ready';
    store.error = null;
    console.log('[ad] rewarded ad ready');
    notify();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.state = 'failed';
    store.error = msg;
    console.error('[ad] preload failed:', msg);
    notify();
  }
}

/**
 * Show the rewarded ad. Returns true if the user completed watching.
 * Must be called only when state is 'ready'.
 */
export async function showAd(sceneId: string): Promise<boolean> {
  if (DEV_BYPASS) {
    console.log(`[ad] DEV bypass — auto-unlocking scene ${sceneId}`);
    store.unlockedScenes.add(sceneId);
    store.state = 'watched';
    notify();
    return true;
  }

  if (store.state !== 'ready') {
    console.warn(`[ad] cannot show ad — state is ${store.state}, not ready`);
    return false;
  }

  store.state = 'showing';
  notify();

  try {
    // TODO: Replace with actual Toss MiniApp SDK rewarded ad show
    // Example:
    //   import { showRewardedAd } from '@apps-in-toss/web-framework';
    //   const result = await showRewardedAd({ unitId: AD_UNIT_ID });
    //   if (!result.rewarded) throw new Error('Ad not completed');
    //
    // 샌드박스에서는 이 호출이 실패합니다.
    console.log(`[ad] showing rewarded ad for scene ${sceneId}...`);

    // Simulated ad view for development
    await new Promise((resolve) => setTimeout(resolve, 800));

    store.unlockedScenes.add(sceneId);
    store.state = 'watched';
    console.log(`[ad] scene ${sceneId} unlocked`);
    notify();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.state = 'failed';
    store.error = msg;
    console.error('[ad] show failed:', msg);
    notify();
    return false;
  }
}

/**
 * Reset ad state back to idle. Call after navigation or to retry.
 */
export function resetAdState(): void {
  store.state = 'idle';
  store.error = null;
  notify();
}

/**
 * Clear all unlocked scenes (e.g., on new upload session).
 */
export function clearUnlocks(): void {
  store.unlockedScenes.clear();
  store.state = 'idle';
  store.error = null;
}
