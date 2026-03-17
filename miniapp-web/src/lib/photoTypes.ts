/**
 * Photo classification + feature model definitions.
 *
 * Determines photo type (selfie, group, landscape, etc.) and
 * framing type (closeup, half-body, full-body, wide) from face analysis.
 */

import type { FaceResult, SingleFaceInfo } from './faceAnalyzer';

// ─── Enums ───────────────────────────────────────────────

export type PhotoType = 'selfie' | 'portrait' | 'group_photo' | 'travel_portrait' | 'landscape';
export type FramingType = 'closeup' | 'half_body' | 'full_body' | 'wide';

// ─── Comprehensive feature set per photo ─────────────────

export interface PhotoFeatures {
  fileId: string;
  timestamp: number;
  width: number;
  height: number;

  sceneEmbed: Float32Array;

  blur: number;
  faceBlur: number;
  exposure: number;
  composition: number;

  face: FaceResult;

  photoType: PhotoType;
  framingType: FramingType;
  hasFaceCut: boolean;

  flattering: number;
  poseNatural: number;
  smileQuality: number;
  bgSimplicity: number;
  thirdsScore: number;
}

// ─── Classification ──────────────────────────────────────

export function classifyPhotoType(face: FaceResult, _w: number, _h: number): PhotoType {
  if (face.faceCount === 0) return 'landscape';

  if (face.faceCount >= 2) return 'group_photo';

  const mainFace = face.faces[0];
  const faceArea = mainFace.box.w * mainFace.box.h;

  if (faceArea > 0.06) return 'selfie';
  if (faceArea > 0.015) return 'portrait';
  return 'travel_portrait';
}

export function detectFraming(face: FaceResult): FramingType {
  if (face.faceCount === 0) return 'wide';

  const largestSize = Math.max(...face.faces.map((f) => f.size));

  if (largestSize > 0.30) return 'closeup';
  if (largestSize > 0.15) return 'half_body';
  if (largestSize > 0.06) return 'full_body';
  return 'wide';
}

// ─── Face edge-cut detection ─────────────────────────────

const EDGE_MARGIN = 0.015;
const BOTTOM_MARGIN = 0.005;

function isFaceCutSingle(f: SingleFaceInfo): boolean {
  const left = f.box.x < EDGE_MARGIN;
  const top = f.box.y < EDGE_MARGIN;
  const right = (f.box.x + f.box.w) > (1 - EDGE_MARGIN);
  // Bottom uses a much smaller margin — chin touching bottom edge is normal in selfies
  const bottom = (f.box.y + f.box.h) > (1 - BOTTOM_MARGIN);

  if (left || top || right) return true;
  // Bottom cut only counts if face is large (selfie) — small faces at bottom are usually just framing
  if (bottom && f.size > 0.15) return false;
  return bottom;
}

export function hasAnyFaceCut(face: FaceResult): boolean {
  return face.faces.some(isFaceCutSingle);
}
