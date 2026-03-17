/**
 * Eye-state detection using MediaPipe FaceLandmarker blendshapes.
 *
 * Strategy: face-api.js detects faces first, then each detected face
 * is cropped and enlarged before being passed to MediaPipe.
 * This gives MediaPipe a close-up face image, dramatically improving
 * detection success rate vs. passing the full scene image.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export interface EyeBlinkResult {
  blinkLeft: number;
  blinkRight: number;
  blinkScore: number;
}

let landmarker: FaceLandmarker | null = null;
let _loading = false;
let _ready = false;
let _error: string | null = null;
let _callCount = 0;
let _tsCounter = 0;
let _successCount = 0;
let _failCount = 0;

export function isEyeStateReady(): boolean {
  return _ready;
}

export function getEyeStateError(): string | null {
  return _error;
}

export function getEyeStateStats() {
  return { success: _successCount, fail: _failCount, total: _callCount };
}

const MODEL_CDN = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

export async function initEyeState(): Promise<void> {
  if (_ready || _loading) return;
  _loading = true;

  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm',
    );

    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_CDN,
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      outputFaceBlendshapes: true,
      numFaces: 1,
    });

    _ready = true;
    console.log('[eyeState] MediaPipe FaceLandmarker loaded (CPU, VIDEO, CDN, crop-per-face mode)');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _error = msg;
    console.error('[eyeState] FAILED to load MediaPipe FaceLandmarker:', err);
  } finally {
    _loading = false;
  }
}

/**
 * Detect eye-blink on a SINGLE CROPPED face image.
 *
 * @param faceCrop - Canvas containing a cropped, enlarged face region.
 *                   Should be ~256–512px for best results.
 * @returns Blink result or null if detection failed.
 */
export function detectSingleFaceBlink(faceCrop: HTMLCanvasElement): EyeBlinkResult | null {
  if (!landmarker || !_ready) return null;

  _callCount++;
  const log = _callCount <= 30 || _callCount % 50 === 0;

  _tsCounter += 33;
  let result;
  try {
    result = landmarker.detectForVideo(faceCrop, _tsCounter);
  } catch (err) {
    if (log) console.error(`[eyeState #${_callCount}] detectForVideo threw:`, err);
    _failCount++;
    return null;
  }

  const blendshapeCount = result.faceBlendshapes?.length ?? 0;

  if (blendshapeCount === 0) {
    _failCount++;
    if (log) {
      console.log(`[eyeState #${_callCount}] crop ${faceCrop.width}x${faceCrop.height} → no face found`);
    }
    return null;
  }

  const shapes = result.faceBlendshapes![0].categories;
  let blinkLeft = 0;
  let blinkRight = 0;

  for (const cat of shapes) {
    if (cat.categoryName === 'eyeBlinkLeft') blinkLeft = cat.score;
    if (cat.categoryName === 'eyeBlinkRight') blinkRight = cat.score;
  }

  // Use AVERAGE of both eyes — not max.
  // Max causes false positives when camera angle makes one eye appear closed.
  // Real eye closure affects BOTH eyes; one-sided high scores indicate angle artifacts.
  const avg = (blinkLeft + blinkRight) / 2;
  const diff = Math.abs(blinkLeft - blinkRight);

  // If left/right disagree strongly, reduce confidence (likely angle artifact)
  const blinkScore = diff > 0.3 ? avg * 0.7 : avg;
  _successCount++;

  if (log) {
    console.log(
      `[eyeState #${_callCount}] crop ${faceCrop.width}x${faceCrop.height} → L=${blinkLeft.toFixed(3)} R=${blinkRight.toFixed(3)} avg=${avg.toFixed(3)} diff=${diff.toFixed(3)} → score=${blinkScore.toFixed(3)}`,
    );
  }

  return { blinkLeft, blinkRight, blinkScore };
}

/**
 * Create a cropped canvas from a face bounding box in the source bitmap.
 * Adds generous padding (60% of face width) to give MediaPipe
 * enough context (forehead, chin, ears) for reliable landmark detection.
 *
 * @param bitmap - Original full-resolution image
 * @param faceBox - Normalized face bounding box {x, y, w, h} in [0, 1]
 * @param targetSize - Output canvas size (square). Default 384.
 */
export function cropFaceForMediaPipe(
  bitmap: ImageBitmap,
  faceBox: { x: number; y: number; w: number; h: number },
  targetSize = 384,
): HTMLCanvasElement {
  const bw = bitmap.width;
  const bh = bitmap.height;

  // Convert normalized coords to pixels
  const fx = faceBox.x * bw;
  const fy = faceBox.y * bh;
  const fw = faceBox.w * bw;
  const fh = faceBox.h * bh;

  // For large faces (>300px), use bigger target to avoid downscale quality loss
  const facePixels = Math.max(fw, fh);
  if (facePixels > 300) targetSize = Math.min(512, Math.round(facePixels * 1.5));

  // Generous padding: 70% of face size on each side for better context
  const pad = Math.max(fw, fh) * 0.7;
  const sx = Math.max(0, fx - pad);
  const sy = Math.max(0, fy - pad);
  const ex = Math.min(bw, fx + fw + pad);
  const ey = Math.min(bh, fy + fh + pad);
  const sw = ex - sx;
  const sh = ey - sy;

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, targetSize, targetSize);

  return canvas;
}
