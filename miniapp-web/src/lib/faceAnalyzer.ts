/**
 * face-api.js wrapper — multi-face detection with identity + expression.
 *
 * Detector strategy (in order of preference):
 *   1. SSD MobileNet V1 — best accuracy, handles small faces well
 *   2. TinyFaceDetector — fallback if SSD unavailable or fails
 *
 * Model loading strategy:
 *   - SSD detector: preferred — better accuracy for small/angled faces
 *   - Tiny detector + landmarks: REQUIRED fallback
 *   - Recognition (128-dim descriptor): OPTIONAL — fail = grouping uses layout only
 *   - Expression (7-class): OPTIONAL — fail = expression defaults to neutral
 */

import * as faceapi from '@vladmandic/face-api';
import { initEyeState, detectSingleFaceBlink, cropFaceForMediaPipe, isEyeStateReady } from './eyeStateAnalyzer';

export interface SingleFaceInfo {
  box: { x: number; y: number; w: number; h: number };
  ear: number;
  minEyeEAR: number;
  eyeContrast: number;
  /** MediaPipe blendshape eye-blink score: 0 = open, 1 = closed. -1 = unavailable */
  eyeBlinkScore: number;
  cx: number;
  cy: number;
  size: number;
  confidence: number;
  descriptor: Float32Array;
  expression: { happy: number; neutral: number; best: string; bestScore: number };
  headRoll: number;
  headYaw: number;
  mouthWidthRatio: number;
  mouthOpenRatio: number;
}

export interface FaceResult {
  faceCount: number;
  rawFaceCount: number;
  faces: SingleFaceInfo[];
  worstEAR: number;
  bestFaceRatio: number;
  avgFacePosition: { x: number; y: number };
  worstExpression: number;
}

const EMPTY_DESCRIPTOR = new Float32Array(128);
const NEUTRAL_EXPRESSION = { happy: 0, neutral: 1, best: 'neutral' as const, bestScore: 1 };

const NO_FACE_RESULT: FaceResult = {
  faceCount: 0,
  rawFaceCount: 0,
  faces: [],
  worstEAR: 0.7,
  bestFaceRatio: 0,
  avgFacePosition: { x: 0.5, y: 0.5 },
  worstExpression: 0.5,
};

let coreLoaded = false;
let hasSSD = false;
let hasRecognition = false;
let hasExpression = false;

export interface ModelLoadStatus {
  core: boolean;
  ssd: boolean;
  recognition: boolean;
  expression: boolean;
  mediapipe: boolean;
  error: string | null;
}

let _loadStatus: ModelLoadStatus = { core: false, ssd: false, recognition: false, expression: false, mediapipe: false, error: null };

export function getModelLoadStatus(): ModelLoadStatus { return _loadStatus; }

export async function loadModels(): Promise<void> {
  if (coreLoaded) return;

  const tf = faceapi.tf as any;
  if (tf?.getBackend) {
    console.log(`[face-api] TF.js backend: "${tf.getBackend()}", version: ${tf.version?.['tfjs-core'] ?? 'unknown'}`);
  }

  const base = '/models';

  // SSD MobileNet V1 — preferred detector (much better for small faces)
  try {
    await faceapi.nets.ssdMobilenetv1.loadFromUri(base);
    hasSSD = true;
    _loadStatus.ssd = true;
    console.log('[face-api] SSD MobileNet V1 loaded (primary detector)');
  } catch (err) {
    console.warn('[face-api] SSD MobileNet failed — will use TinyFaceDetector:', err);
  }

  // Core: TinyFaceDetector + landmarks — required as fallback (or primary if SSD fails)
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(base);
    await faceapi.nets.faceLandmark68Net.loadFromUri(base);
    coreLoaded = true;
    _loadStatus.core = true;
    console.log('[face-api] core models loaded (tiny detector + landmarks)');
  } catch (err) {
    if (!hasSSD) {
      const msg = err instanceof Error ? err.message : String(err);
      _loadStatus.error = `no detector available: ${msg}`;
      console.error('[face-api] CRITICAL: no detector could load', err);
      return;
    }
    console.warn('[face-api] TinyFaceDetector failed but SSD is available');
    coreLoaded = true;
    _loadStatus.core = true;
  }

  // Optional: recognition
  try {
    await faceapi.nets.faceRecognitionNet.loadFromUri(base);
    hasRecognition = true;
    _loadStatus.recognition = true;
    console.log('[face-api] recognition model loaded (128-dim descriptors)');
  } catch (err) {
    console.warn('[face-api] recognition model failed:', err);
  }

  // Optional: expression
  try {
    await faceapi.nets.faceExpressionNet.loadFromUri(base);
    hasExpression = true;
    _loadStatus.expression = true;
    console.log('[face-api] expression model loaded (7-class)');
  } catch (err) {
    console.warn('[face-api] expression model failed:', err);
  }

  if (tf?.getBackend) {
    console.log(`[face-api] ready — SSD:${hasSSD} Tiny:${_loadStatus.core} Recog:${hasRecognition} Expr:${hasExpression} backend:${tf.getBackend()}`);
  }

  // MediaPipe FaceLandmarker for ML-based eye-blink detection
  // Must await — otherwise images start processing before MediaPipe is ready
  try {
    await initEyeState();
    _loadStatus.mediapipe = isEyeStateReady();
    console.log(`[face-api] MediaPipe eye-state: ${_loadStatus.mediapipe ? 'ready' : 'failed'}`);
  } catch (err) {
    console.warn('[face-api] MediaPipe eye-state init failed (blink detection degraded):', err);
  }
}

function ptDist(a: faceapi.Point, b: faceapi.Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function computeEAR(landmarks: faceapi.FaceLandmarks68): { avg: number; min: number } {
  const pts = landmarks.positions;
  const leftEAR =
    (ptDist(pts[37], pts[41]) + ptDist(pts[38], pts[40])) /
    (2 * ptDist(pts[36], pts[39]));
  const rightEAR =
    (ptDist(pts[43], pts[47]) + ptDist(pts[44], pts[46])) /
    (2 * ptDist(pts[42], pts[45]));
  return { avg: (leftEAR + rightEAR) / 2, min: Math.min(leftEAR, rightEAR) };
}

/**
 * Pixel-level eye openness check — independent of landmark-based EAR.
 * Detects the presence of the iris/pupil (dark region) within the eye area.
 *
 * Open eyes: dark iris/pupil creates a cluster of pixels significantly darker
 *            than the surrounding skin/sclera → high darkRatio + high percentile gap.
 * Closed eyes: uniform skin-colored eyelid → low darkRatio, narrow percentile gap.
 *
 * Returns 0–1 where low = likely closed, high = likely open.
 */
function computeEyePixelOpenness(
  ctx: CanvasRenderingContext2D,
  landmarks: faceapi.FaceLandmarks68,
  w: number,
  h: number,
): number {
  const pts = landmarks.positions;
  let _logOnce = _eyePixelLogCount < 3;

  function eyeOpenScore(indices: number[]): number {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of indices) {
      minX = Math.min(minX, pts[i].x);
      minY = Math.min(minY, pts[i].y);
      maxX = Math.max(maxX, pts[i].x);
      maxY = Math.max(maxY, pts[i].y);
    }

    // Tight crop: minimal vertical padding to avoid eyebrow contamination
    const padX = (maxX - minX) * 0.05;
    const padY = (maxY - minY) * 0.15;
    const x0 = Math.max(0, Math.round(minX - padX));
    const y0 = Math.max(0, Math.round(minY - padY));
    const x1 = Math.min(w, Math.round(maxX + padX));
    const y1 = Math.min(h, Math.round(maxY + padY));

    const cropW = x1 - x0;
    const cropH = y1 - y0;
    if (cropW < 3 || cropH < 2) return 0.5;

    const imgData = ctx.getImageData(x0, y0, cropW, cropH);
    const data = imgData.data;
    const n = data.length / 4;
    if (n < 50) {
      if (_logOnce) console.log(`[eyePixel] SKIP: too few pixels (${cropW}x${cropH}=${n}px) — face too small`);
      return 0.5;
    }

    const grays = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      grays[i] = data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114;
    }

    const sorted = Array.from(grays).sort((a, b) => a - b);
    const p10 = sorted[Math.floor(n * 0.10)];
    const p50 = sorted[Math.floor(n * 0.50)];
    const p90 = sorted[Math.floor(n * 0.90)];

    if (p90 < 10) return 0.5;

    // Signal 1: Percentile range — how much dynamic range exists in the eye region
    const pRange = (p90 - p10) / p90;

    // Signal 2: Dark pixel ratio — fraction of pixels significantly darker than median
    // Iris/pupil pixels are typically 25-40% darker than surrounding skin/sclera
    const darkThresh = p50 * 0.70;
    let darkCount = 0;
    for (let i = 0; i < n; i++) {
      if (grays[i] < darkThresh) darkCount++;
    }
    const darkRatio = darkCount / n;

    if (_logOnce) {
      console.log(`[eyePixel] crop=${cropW}x${cropH} n=${n} p10=${p10.toFixed(0)} p50=${p50.toFixed(0)} p90=${p90.toFixed(0)} pRange=${pRange.toFixed(3)} darkRatio=${darkRatio.toFixed(3)}`);
    }

    // Open eye: pRange ~0.30-0.60, darkRatio ~0.08-0.25
    // Closed eye: pRange ~0.10-0.25, darkRatio ~0.01-0.05
    const rangeScore = Math.min(1, Math.max(0, (pRange - 0.15) / 0.25));
    const darkScore = Math.min(1, Math.max(0, (darkRatio - 0.02) / 0.10));

    return Math.min(rangeScore, darkScore);
  }

  const leftScore = eyeOpenScore([36, 37, 38, 39, 40, 41]);
  const rightScore = eyeOpenScore([42, 43, 44, 45, 46, 47]);
  const result = Math.min(leftScore, rightScore);

  // Always log for first 10 faces, then every 20th face for ongoing monitoring
  if (_eyePixelLogCount < 10 || _eyePixelLogCount % 20 === 0) {
    console.log(`[eyePixel #${_eyePixelLogCount}] L=${leftScore.toFixed(3)} R=${rightScore.toFixed(3)} → px=${result.toFixed(3)}`);
  }
  _eyePixelLogCount++;

  return result;
}

let _eyePixelLogCount = 0;

function parseExpression(expr: faceapi.FaceExpressions): SingleFaceInfo['expression'] {
  const happy = expr.happy ?? 0;
  const neutral = expr.neutral ?? 0;
  let best = 'neutral';
  let bestScore = 0;
  for (const [key, val] of Object.entries(expr)) {
    if (typeof val === 'number' && val > bestScore) {
      bestScore = val;
      best = key;
    }
  }
  return { happy, neutral, best, bestScore };
}

const MAX_DIM = 1600;

function prepareCanvas(bitmap: ImageBitmap): { canvas: HTMLCanvasElement; w: number; h: number } {
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  return { canvas, w, h };
}

function computeHeadPose(landmarks: faceapi.FaceLandmarks68): { roll: number; yaw: number } {
  const pts = landmarks.positions;

  // Roll: angle between eye centers (radians → degrees)
  const leftEyeCenter = { x: (pts[36].x + pts[39].x) / 2, y: (pts[36].y + pts[39].y) / 2 };
  const rightEyeCenter = { x: (pts[42].x + pts[45].x) / 2, y: (pts[42].y + pts[45].y) / 2 };
  const roll = Math.atan2(rightEyeCenter.y - leftEyeCenter.y, rightEyeCenter.x - leftEyeCenter.x) * (180 / Math.PI);

  // Yaw: nose tip (30) offset from face midpoint (between 0=jaw right and 16=jaw left)
  const faceMidX = (pts[0].x + pts[16].x) / 2;
  const faceWidth = Math.abs(pts[16].x - pts[0].x) || 1;
  const yaw = ((pts[30].x - faceMidX) / faceWidth) * 90;

  return { roll, yaw };
}

function computeMouthMetrics(landmarks: faceapi.FaceLandmarks68): { widthRatio: number; openRatio: number } {
  const pts = landmarks.positions;
  const faceWidth = Math.abs(pts[16].x - pts[0].x) || 1;

  // Mouth width: corner to corner (48, 54)
  const mouthWidth = ptDist(pts[48], pts[54]);
  const widthRatio = mouthWidth / faceWidth;

  // Mouth openness: top lip center (51) to bottom lip center (57) / mouth width
  const mouthOpen = ptDist(pts[51], pts[57]);
  const openRatio = mouthWidth > 0 ? mouthOpen / mouthWidth : 0;

  return { widthRatio, openRatio };
}

function buildFaceInfo(
  det: faceapi.WithFaceLandmarks<{ detection: faceapi.FaceDetection }>,
  w: number,
  h: number,
  descriptor: Float32Array | null,
  expression: faceapi.FaceExpressions | null,
  ctx: CanvasRenderingContext2D | null,
): SingleFaceInfo {
  const box = det.detection.box;
  const pose = computeHeadPose(det.landmarks);
  const mouth = computeMouthMetrics(det.landmarks);
  const earResult = computeEAR(det.landmarks);
  const eyeContrast = ctx ? computeEyePixelOpenness(ctx, det.landmarks, w, h) : 0.5;
  return {
    box: { x: box.x / w, y: box.y / h, w: box.width / w, h: box.height / h },
    ear: earResult.avg,
    minEyeEAR: earResult.min,
    eyeContrast,
    eyeBlinkScore: -1,
    cx: (box.x + box.width / 2) / w,
    cy: (box.y + box.height / 2) / h,
    size: box.width / w,
    confidence: det.detection.score,
    descriptor: descriptor ?? new Float32Array(EMPTY_DESCRIPTOR),
    expression: expression ? parseExpression(expression) : { ...NEUTRAL_EXPRESSION },
    headRoll: pose.roll,
    headYaw: pose.yaw,
    mouthWidthRatio: mouth.widthRatio,
    mouthOpenRatio: mouth.openRatio,
  };
}

/**
 * Non-Maximum Suppression: remove duplicate detections of the same face.
 * Two checks — a face is duplicate if EITHER condition is true:
 *   1. IoU > 0.25 (boxes overlap significantly)
 *   2. Center distance < 70% of larger face size (same face, different scale)
 * Higher-confidence detection always wins.
 */
function nms(faces: SingleFaceInfo[]): SingleFaceInfo[] {
  if (faces.length <= 1) return faces;

  const sorted = [...faces].sort((a, b) => b.confidence - a.confidence);
  const kept: SingleFaceInfo[] = [];

  for (const face of sorted) {
    let isDuplicate = false;
    for (const existing of kept) {
      if (isSameFace(face, existing)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) kept.push(face);
  }
  return kept;
}

function isSameFace(a: SingleFaceInfo, b: SingleFaceInfo): boolean {
  // Check 1: IoU overlap
  const iou = computeIoU(a.box, b.box);
  if (iou > 0.25) return true;

  // Check 2: center proximity — conservative to avoid merging adjacent people
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxSize = Math.max(a.size, b.size);
  if (dist < maxSize * 0.45) return true;

  return false;
}

function computeIoU(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const inter = interW * interH;

  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - inter;

  return union > 0 ? inter / union : 0;
}

/**
 * Remove background bystanders: faces much smaller than the dominant face
 * are likely background people, not the main subjects.
 *
 * Three-tier filter:
 *   1. Absolute minimum: face < 3% of image width → always remove
 *   2. Relative minimum: face < 30% of the largest face → remove unless very high confidence
 *   3. Gap detection: if there's a clear size gap between main group and outliers, remove outliers
 */
function filterBackgroundFaces(faces: SingleFaceInfo[]): SingleFaceInfo[] {
  if (faces.length <= 1) return faces;

  const maxSize = Math.max(...faces.map((f) => f.size));

  // Sort by size descending for gap detection
  const sorted = [...faces].map((f) => f.size).sort((a, b) => b - a);

  // Find the biggest gap ratio between consecutive sorted sizes
  // e.g., sizes [0.08, 0.07, 0.05, 0.02] → gap at 0.05→0.02 (ratio 0.40)
  let gapThreshold = 0;
  if (sorted.length >= 3) {
    let biggestGapRatio = 1;
    let gapCutoff = 0;
    for (let i = 1; i < sorted.length; i++) {
      const ratio = sorted[i] / sorted[i - 1];
      if (ratio < biggestGapRatio && ratio < 0.55) {
        biggestGapRatio = ratio;
        gapCutoff = (sorted[i] + sorted[i - 1]) / 2;
      }
    }
    gapThreshold = gapCutoff;
  }

  return faces.filter((f) => {
    // Sanity check: real eyes have EAR 0.05-0.45. Higher values = false detection (hand, object, etc.)
    if (f.ear > 0.45) return false;

    if (f.size < 0.03) return false;

    if (gapThreshold > 0 && f.size < gapThreshold && f.confidence < 0.85) return false;

    const relSize = f.size / maxSize;
    if (relSize >= 0.35) return true;

    return f.confidence >= 0.80;
  });
}

function summarizeFaces(faces: SingleFaceInfo[], rawCount?: number): FaceResult {
  // Use per-eye minimum (not average) for blink detection —
  // average masks single-eye blinks, min catches them.
  const earValues = faces.map((f) => Math.min(1, Math.max(0, (f.minEyeEAR - 0.15) / 0.20)));

  const worstEAR = earValues.length > 0 ? Math.min(...earValues) : 0.7;

  const bestFaceRatio = Math.max(...faces.map((f) => f.box.w * f.box.h));
  const avgX = faces.reduce((s, f) => s + f.cx, 0) / faces.length;
  const avgY = faces.reduce((s, f) => s + f.cy, 0) / faces.length;

  const exprScores = faces.map((f) =>
    Math.min(1, f.expression.happy * 1.2 + f.expression.neutral * 0.7),
  );
  const worstExpression = exprScores.length > 0 ? Math.min(...exprScores) : 0.5;

  return { faceCount: faces.length, rawFaceCount: rawCount ?? faces.length, faces, worstEAR, bestFaceRatio, avgFacePosition: { x: avgX, y: avgY }, worstExpression };
}

/**
 * For each face detected by face-api.js, crop the face region from the
 * original bitmap, enlarge it, and run MediaPipe to get blink scores.
 * This bypasses MediaPipe's unreliable full-image face detection.
 */
function applyBlinkScoresViaCrop(
  faces: SingleFaceInfo[],
  bitmap: ImageBitmap,
  logIdx: number,
): void {
  if (!isEyeStateReady()) return;
  const log = logIdx < 20 || logIdx % 50 === 0;

  for (let i = 0; i < faces.length; i++) {
    const face = faces[i];
    try {
      const crop = cropFaceForMediaPipe(bitmap, face.box, 384);
      const result = detectSingleFaceBlink(crop);

      if (result) {
        face.eyeBlinkScore = result.blinkScore;
        if (log) {
          console.log(
            `[blink #${logIdx}] face${i}(sz=${face.size.toFixed(3)}): MP blink=${result.blinkScore.toFixed(3)} (L=${result.blinkLeft.toFixed(3)} R=${result.blinkRight.toFixed(3)}) EAR=${face.minEyeEAR.toFixed(3)}`,
          );
        }
      } else if (log) {
        console.log(`[blink #${logIdx}] face${i}(sz=${face.size.toFixed(3)}): MediaPipe crop failed, using EAR=${face.minEyeEAR.toFixed(3)}`);
      }
    } catch (err) {
      if (log) console.warn(`[blink #${logIdx}] face${i} crop error:`, err);
    }
  }
}

let _diagIdx = 0;

export async function analyzeAllFaces(bitmap: ImageBitmap): Promise<FaceResult> {
  const idx = _diagIdx++;
  const verbose = idx < 5;

  if (!coreLoaded) {
    if (verbose) console.error(`[face #${idx}] models NOT loaded`);
    return NO_FACE_RESULT;
  }

  const { canvas, w, h } = prepareCanvas(bitmap);
  const ctx = canvas.getContext('2d')!;

  if (verbose) {
    const sample = ctx.getImageData(0, 0, Math.min(w, 4), Math.min(h, 4)).data;
    const nonZero = Array.from(sample).filter((v) => v > 0).length;
    console.log(`[face #${idx}] canvas ${w}x${h}, bitmap ${bitmap.width}x${bitmap.height}, pixels ok=${nonZero > 0}`);
  }

  /** Finalize: crop each face → MediaPipe blink → summarize */
  function finalize(faces: SingleFaceInfo[], rawCount: number): FaceResult {
    applyBlinkScoresViaCrop(faces, bitmap, idx);
    return summarizeFaces(faces, rawCount);
  }

  // ── Primary detector: SSD MobileNet V1 ──
  if (hasSSD) {
    const ssdOpts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.50 });

    // Full chain with SSD
    if (hasRecognition && hasExpression) {
      try {
        const dets = await faceapi
          .detectAllFaces(canvas, ssdOpts)
          .withFaceLandmarks()
          .withFaceDescriptors()
          .withFaceExpressions();

        if (verbose) console.log(`[face #${idx}] SSD full: ${dets.length} raw faces [${dets.map((d) => d.detection.score.toFixed(2)).join(',')}]`);

        if (dets.length > 0) {
          const raw = dets.map((d) => buildFaceInfo(d, w, h, d.descriptor, d.expressions, ctx));
          const deduped = nms(raw);
          const faces = filterBackgroundFaces(deduped);
          if (verbose && faces.length !== raw.length) console.log(`[face #${idx}] NMS+filter ${raw.length}→${deduped.length}→${faces.length}`);
          return finalize(faces, raw.length);
        }
      } catch (err) {
        if (verbose) console.warn(`[face #${idx}] SSD full chain error:`, err);
      }
    }

    // SSD + landmarks only
    try {
      const dets = await faceapi
        .detectAllFaces(canvas, ssdOpts)
        .withFaceLandmarks();

      if (verbose) console.log(`[face #${idx}] SSD landmarks: ${dets.length} raw faces [${dets.map((d) => d.detection.score.toFixed(2)).join(',')}]`);

      if (dets.length > 0) {
        const raw = dets.map((d) => buildFaceInfo(d, w, h, null, null, ctx));
        const deduped = nms(raw);
        const faces = filterBackgroundFaces(deduped);
        if (verbose && faces.length !== raw.length) console.log(`[face #${idx}] NMS+filter ${raw.length}→${deduped.length}→${faces.length}`);
        return finalize(faces, raw.length);
      }
    } catch (err) {
      if (verbose) console.warn(`[face #${idx}] SSD landmarks error:`, err);
    }

    // SSD raw detection (no landmarks) — last attempt with SSD
    try {
      const rawDets = await faceapi.detectAllFaces(canvas, ssdOpts);
      if (verbose && rawDets.length > 0) {
        console.log(`[face #${idx}] SSD raw: ${rawDets.length} faces (landmarks failed but detection worked)`);
      }
    } catch (err) {
      if (verbose) console.warn(`[face #${idx}] SSD raw error:`, err);
    }
  }

  // ── Fallback: TinyFaceDetector ──
  const tinyOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.50 });

  if (hasRecognition && hasExpression) {
    try {
      const dets = await faceapi
        .detectAllFaces(canvas, tinyOpts)
        .withFaceLandmarks()
        .withFaceDescriptors()
        .withFaceExpressions();

      if (verbose) console.log(`[face #${idx}] Tiny full: ${dets.length} raw faces [${dets.map((d) => d.detection.score.toFixed(2)).join(',')}]`);

      if (dets.length > 0) {
        const raw = dets.map((d) => buildFaceInfo(d, w, h, d.descriptor, d.expressions, ctx));
        const faces = filterBackgroundFaces(nms(raw));
        return finalize(faces, raw.length);
      }
    } catch (err) {
      if (verbose) console.warn(`[face #${idx}] Tiny full chain error:`, err);
    }
  }

  try {
    const dets = await faceapi
      .detectAllFaces(canvas, tinyOpts)
      .withFaceLandmarks();

    if (verbose) console.log(`[face #${idx}] Tiny landmarks: ${dets.length} raw faces`);

    if (dets.length > 0) {
      const raw = dets.map((d) => buildFaceInfo(d, w, h, null, null, ctx));
      const faces = filterBackgroundFaces(nms(raw));
      return finalize(faces, raw.length);
    }
  } catch (err) {
    if (verbose) console.warn(`[face #${idx}] Tiny fallback error:`, err);
  }

  if (verbose) console.log(`[face #${idx}] NO faces found by any detector`);
  return NO_FACE_RESULT;
}
