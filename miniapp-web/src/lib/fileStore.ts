import { startTimer } from './perf';

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  status: 'pending' | 'processing' | 'done' | 'filtered';
}

const fileMap = new Map<string, File>();
let manifest: FileEntry[] = [];

export function ingestFiles(files: File[]): FileEntry[] {
  const timer = startTimer(`ingest ${files.length} files`);
  const batch: FileEntry[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const id = `f_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
    fileMap.set(id, file);
    batch.push({
      id,
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      status: 'pending',
    });
  }

  manifest = [...manifest, ...batch];
  timer.end();
  return batch;
}

export function getFile(id: string): File | undefined {
  return fileMap.get(id);
}

export function getManifest(): FileEntry[] {
  return manifest;
}

export function getCount(): number {
  return manifest.length;
}

export function getTotalSize(): number {
  return manifest.reduce((sum, e) => sum + e.size, 0);
}

export function clear() {
  fileMap.clear();
  manifest = [];
}
