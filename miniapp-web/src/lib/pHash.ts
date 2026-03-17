/**
 * Scene embedding — hybrid structure + color descriptor.
 *
 * Problem with raw RGB pixels: outdoor photos have similar overall colors,
 * causing cosine similarity > 0.87 even for completely different locations.
 *
 * Solution: combine two signals that each capture different aspects:
 *   1. Mean-subtracted color (spatial PATTERN, not absolute color) — 48x48 gray = 2304 dim
 *   2. Gradient magnitude (edge/structure patterns) — 47x47 = 2209 dim
 *   3. Block color layout (6x6 spatial color grid) — 108 dim
 *
 * Total: 4621 dim, L2-normalized.
 *
 * Same-location photos: high gradient + pattern similarity → high cosine
 * Different-location photos: different edges/structures → low cosine
 *
 * IMPORTANT: Each call creates its own canvas to prevent race conditions.
 */

const EMBED_SIZE = 48;

export function computeSceneEmbedding(bitmap: ImageBitmap): Float32Array {
  const canvas = new OffscreenCanvas(EMBED_SIZE, EMBED_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, EMBED_SIZE, EMBED_SIZE);
  const { data } = ctx.getImageData(0, 0, EMBED_SIZE, EMBED_SIZE);

  const pixels = EMBED_SIZE * EMBED_SIZE;

  // ── Part 1: Mean-subtracted grayscale (captures spatial pattern) ──
  const gray = new Float32Array(pixels);
  let graySum = 0;
  for (let i = 0; i < pixels; i++) {
    const off = i * 4;
    gray[i] = data[off] * 0.299 + data[off + 1] * 0.587 + data[off + 2] * 0.114;
    graySum += gray[i];
  }
  const grayMean = graySum / pixels;
  const pattern = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) pattern[i] = gray[i] - grayMean;

  // ── Part 2: Gradient magnitude (captures edges/structure) ──
  const gW = EMBED_SIZE - 1;
  const gH = EMBED_SIZE - 1;
  const gradients = new Float32Array(gW * gH);
  for (let y = 0; y < gH; y++) {
    for (let x = 0; x < gW; x++) {
      const idx = y * EMBED_SIZE + x;
      const gx = gray[idx + 1] - gray[idx];
      const gy = gray[idx + EMBED_SIZE] - gray[idx];
      gradients[y * gW + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // ── Part 3: Block color layout (6x6 grid, RGB averages) ──
  const BLOCKS = 6;
  const blockSize = EMBED_SIZE / BLOCKS;
  const blockColors = new Float32Array(BLOCKS * BLOCKS * 3);
  for (let by = 0; by < BLOCKS; by++) {
    for (let bx = 0; bx < BLOCKS; bx++) {
      let rSum = 0, gSum2 = 0, bSum = 0, count = 0;
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const px = Math.floor(bx * blockSize + dx);
          const py = Math.floor(by * blockSize + dy);
          const off = (py * EMBED_SIZE + px) * 4;
          rSum += data[off];
          gSum2 += data[off + 1];
          bSum += data[off + 2];
          count++;
        }
      }
      const bi = (by * BLOCKS + bx) * 3;
      blockColors[bi] = rSum / count;
      blockColors[bi + 1] = gSum2 / count;
      blockColors[bi + 2] = bSum / count;
    }
  }
  // Mean-subtract block colors
  let bcSum = 0;
  for (let i = 0; i < blockColors.length; i++) bcSum += blockColors[i];
  const bcMean = bcSum / blockColors.length;
  for (let i = 0; i < blockColors.length; i++) blockColors[i] -= bcMean;

  // ── Concatenate all parts ──
  const DIM = pattern.length + gradients.length + blockColors.length;
  const vec = new Float32Array(DIM);
  let offset = 0;

  // Weight: gradient 1.5x (most discriminative but not overpowering), pattern 1x, block color 1.5x
  for (let i = 0; i < pattern.length; i++) vec[offset++] = pattern[i];
  for (let i = 0; i < gradients.length; i++) vec[offset++] = gradients[i] * 1.5;
  for (let i = 0; i < blockColors.length; i++) vec[offset++] = blockColors[i] * 1.5;

  // L2 normalize
  let sumSq = 0;
  for (let i = 0; i < DIM; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < DIM; i++) vec[i] /= norm;

  return vec;
}
