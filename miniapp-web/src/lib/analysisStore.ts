import type { AnalysisResult } from './mockAnalysis';

let result: AnalysisResult | null = null;

export function setResult(r: AnalysisResult) {
  result = r;
}

export function getResult(): AnalysisResult | null {
  return result;
}

export function clear() {
  result = null;
}
