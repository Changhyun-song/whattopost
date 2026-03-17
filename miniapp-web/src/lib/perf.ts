const t0 = performance.now();

export function startTimer(label: string) {
  const start = performance.now();
  console.log(`[perf] ▶ ${label}`);
  return {
    end() {
      const ms = performance.now() - start;
      console.log(`[perf] ✓ ${label} — ${ms.toFixed(1)}ms`);
      return ms;
    },
  };
}

export function log(message: string) {
  const elapsed = performance.now() - t0;
  console.log(`[perf] ${message} @ +${elapsed.toFixed(0)}ms`);
}
