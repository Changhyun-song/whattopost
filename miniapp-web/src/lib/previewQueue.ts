import { getFile } from './fileStore';
import { startTimer } from './perf';

const cache = new Map<string, string>();
const BATCH_SIZE = 3;

export function getPreview(id: string): string | undefined {
  return cache.get(id);
}

function yieldToRender(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Generate object-URL previews in batches of BATCH_SIZE, yielding
 * to the render loop between batches so the UI stays responsive
 * even when many files are queued.
 */
export async function generatePreviews(
  ids: string[],
  onReady: (id: string, url: string) => void,
  signal?: { cancelled: boolean },
) {
  const uncached = ids.filter((id) => {
    if (cache.has(id)) {
      onReady(id, cache.get(id)!);
      return false;
    }
    return true;
  });

  if (uncached.length === 0) return;

  const timer = startTimer(`preview ${uncached.length} new items`);
  let done = 0;

  for (const id of uncached) {
    if (signal?.cancelled) break;

    const file = getFile(id);
    if (!file) { done++; continue; }

    const url = URL.createObjectURL(file);
    cache.set(id, url);
    onReady(id, url);
    done++;

    if (done % BATCH_SIZE === 0) await yieldToRender();
  }

  timer.end();
}

export function revokeAll() {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
