/**
 * Lightweight EXIF metadata extraction — browser-only, zero dependencies.
 *
 * Extracts DateTimeOriginal from JPEG EXIF by scanning the first 64KB
 * for the ASCII date pattern. Falls back to File.lastModified.
 */

const EXIF_SCAN_BYTES = 65536;
const DATE_RE = /20\d{2}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/;

export interface PhotoMetadata {
  timestamp: number;
  width: number;
  height: number;
  orientation: number;
}

export async function extractTimestamp(file: File): Promise<number> {
  try {
    const slice = file.slice(0, EXIF_SCAN_BYTES);
    const buf = await slice.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // Safe ASCII extraction without spread (avoids stack overflow on large arrays)
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b >= 0x20 && b < 0x7f) text += String.fromCharCode(b);
    }
    const match = text.match(DATE_RE);

    if (match) {
      const [datePart, timePart] = match[0].split(' ');
      const iso = datePart.replace(/:/g, '-') + 'T' + timePart;
      const ts = new Date(iso).getTime();
      if (!isNaN(ts) && ts > 946684800000) return ts; // sanity: after year 2000
    }
  } catch {
    /* EXIF extraction failed, fall through */
  }

  return file.lastModified || Date.now();
}

export async function extractMetadata(file: File, bmp: ImageBitmap): Promise<PhotoMetadata> {
  const timestamp = await extractTimestamp(file);
  return {
    timestamp,
    width: bmp.width,
    height: bmp.height,
    orientation: 1,
  };
}
