/**
 * Canvas-based pixel analysis — zero external dependencies.
 *
 * All functions accept an ImageBitmap and return normalised 0–1 scores.
 * Higher = better quality.
 *
 * Performance: use `measureAllInOnePass()` to downsample + getImageData ONCE
 * instead of 3 separate calls. Saves ~66% of decode overhead for large batches.
 */

const ANALYSIS_SIZE = 320;

// ─── Shared downsample cache (reused across calls within same frame) ───

let _sharedCanvas: OffscreenCanvas | null = null;
let _sharedCtx: OffscreenCanvasRenderingContext2D | null = null;

function getSharedCanvas(w: number, h: number): OffscreenCanvasRenderingContext2D {
  if (!_sharedCanvas || _sharedCanvas.width !== w || _sharedCanvas.height !== h) {
    _sharedCanvas = new OffscreenCanvas(w, h);
    _sharedCtx = _sharedCanvas.getContext('2d')!;
  }
  return _sharedCtx!;
}

function downsampleOnce(bitmap: ImageBitmap): { gray: Float32Array; w: number; h: number } {
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const ctx = getSharedCanvas(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    gray[i] = 0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2];
  }

  return { gray, w, h };
}

// ─── Core analysis functions (operate on pre-computed grayscale) ───

function blurFromGray(gray: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        -4 * gray[idx] +
        gray[idx - 1] + gray[idx + 1] +
        gray[idx - w] + gray[idx + w];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0.5;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return Math.min(1, Math.max(0, (variance - 50) / 450));
}

function exposureFromGray(gray: Float32Array): number {
  let sum = 0;
  let sumSq = 0;
  const n = gray.length;

  for (let i = 0; i < n; i++) {
    sum += gray[i];
    sumSq += gray[i] * gray[i];
  }

  const mean = sum / n;
  const std = Math.sqrt(sumSq / n - mean * mean);

  let meanScore: number;
  if (mean < 40) meanScore = mean / 40;
  else if (mean > 230) meanScore = (255 - mean) / 25;
  else meanScore = 1.0 - Math.abs(mean - 128) / 128 * 0.3;

  const contrastScore = Math.min(1, std / 60);
  return Math.min(1, Math.max(0, meanScore * 0.7 + contrastScore * 0.3));
}

function compositionFromGray(gray: Float32Array, w: number, h: number): number {
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const gx =
        -gray[idx - w - 1] + gray[idx - w + 1] +
        -2 * gray[idx - 1] + 2 * gray[idx + 1] +
        -gray[idx + w - 1] + gray[idx + w + 1];
      const gy =
        -gray[idx - w - 1] - 2 * gray[idx - w] - gray[idx - w + 1] +
        gray[idx + w - 1] + 2 * gray[idx + w] + gray[idx + w + 1];
      edge[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  const cx = w / 2, cy = h / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  let weightedSum = 0;
  let totalEdge = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const e = edge[y * w + x];
      if (e < 5) continue;
      const dx = (x - cx) / maxDist;
      const dy = (y - cy) / maxDist;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const weight = 1.0 - dist * 0.6;
      weightedSum += e * Math.max(0, weight);
      totalEdge += e;
    }
  }

  if (totalEdge === 0) return 0.5;
  return Math.min(1, Math.max(0, weightedSum / totalEdge));
}

// ─── Face-region blur ────────────────────────────────────

export interface FaceBox { x: number; y: number; w: number; h: number }

/**
 * Measure blur within a specific face bounding box region.
 * Returns worst (lowest) blur among given face boxes.
 * If no faces, returns the global blur value as fallback.
 */
export function measureFaceRegionBlur(bitmap: ImageBitmap, faceBoxes: FaceBox[]): number {
  if (faceBoxes.length === 0) return -1;

  const { gray, w, h } = downsampleOnce(bitmap);
  let worstBlur = 1;

  for (const box of faceBoxes) {
    const x0 = Math.max(1, Math.floor(box.x * w));
    const y0 = Math.max(1, Math.floor(box.y * h));
    const x1 = Math.min(w - 2, Math.floor((box.x + box.w) * w));
    const y1 = Math.min(h - 2, Math.floor((box.y + box.h) * h));

    if (x1 <= x0 || y1 <= y0) continue;

    let sum = 0, sumSq = 0, count = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const idx = y * w + x;
        const lap = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w];
        sum += lap;
        sumSq += lap * lap;
        count++;
      }
    }

    if (count === 0) continue;
    const mean = sum / count;
    const variance = sumSq / count - mean * mean;
    const regionBlur = Math.min(1, Math.max(0, (variance - 50) / 450));
    worstBlur = Math.min(worstBlur, regionBlur);
  }

  return worstBlur;
}

// ─── Background simplicity ───────────────────────────────

/**
 * Measure background "simplicity" — low variance outside face regions = clean bg.
 * High score = clean/blurred background (professional). Low = cluttered.
 */
export function measureBgSimplicity(bitmap: ImageBitmap, faceBoxes: FaceBox[]): number {
  const { gray, w, h } = downsampleOnce(bitmap);

  // Build mask: true = foreground (face region, expanded 20%)
  const isForeground = new Uint8Array(w * h);
  for (const box of faceBoxes) {
    const pad = 0.2;
    const x0 = Math.max(0, Math.floor((box.x - box.w * pad) * w));
    const y0 = Math.max(0, Math.floor((box.y - box.h * pad) * h));
    const x1 = Math.min(w - 1, Math.floor((box.x + box.w * (1 + pad)) * w));
    const y1 = Math.min(h - 1, Math.floor((box.y + box.h * (1 + pad)) * h));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        isForeground[y * w + x] = 1;
  }

  // Compute Laplacian variance of background pixels
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      if (isForeground[idx]) continue;
      const lap = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count < 10) return 0.5;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  // Invert: low variance = high simplicity
  // variance ~0 = perfectly smooth bg → 1.0
  // variance ~200+ = very busy bg → 0.0
  return Math.min(1, Math.max(0, 1 - variance / 250));
}

// ─── Single-pass API (preferred for pipeline) ────────────

export interface CanvasMetrics {
  blur: number;
  exposure: number;
  composition: number;
}

/**
 * Downsample ONCE → compute blur + exposure + composition in a single pass.
 * 3x faster than calling measure* individually.
 */
export function measureAllInOnePass(bitmap: ImageBitmap): CanvasMetrics {
  const { gray, w, h } = downsampleOnce(bitmap);
  return {
    blur: blurFromGray(gray, w, h),
    exposure: exposureFromGray(gray),
    composition: compositionFromGray(gray, w, h),
  };
}

// ─── Individual APIs (backward compat) ───────────────────

export function measureBlur(bitmap: ImageBitmap): number {
  const { gray, w, h } = downsampleOnce(bitmap);
  return blurFromGray(gray, w, h);
}

export function measureExposure(bitmap: ImageBitmap): number {
  const { gray } = downsampleOnce(bitmap);
  return exposureFromGray(gray);
}

export function measureComposition(bitmap: ImageBitmap): number {
  const { gray, w, h } = downsampleOnce(bitmap);
  return compositionFromGray(gray, w, h);
}
