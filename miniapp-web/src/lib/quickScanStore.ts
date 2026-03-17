import type { QuickScanResult } from './mockAnalysis';

let result: QuickScanResult | null = null;

export function setResult(r: QuickScanResult) {
  result = r;
}

export function getResult(): QuickScanResult | null {
  return result;
}

export function clear() {
  result = null;
}
