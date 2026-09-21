export function median(values) {
  if (!values.length || values.some(n => !Number.isFinite(n))) throw new Error("Expected finite samples");
  const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Same adaptive batches as the historical runner. Keep all samples so the
// historical min and the paired experiment's median are explicitly distinguishable.
export function measure(fn, arg, { warmup = 10, trials = 5, batchMs = 30 } = {}) {
  for (let i = 0; i < warmup; i++) fn(arg);
  let reps = 1;
  for (;;) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < reps; i++) fn(arg);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms >= batchMs || reps >= 5e8) break;
    reps = Math.min(5e8, Math.max(reps + 1, Math.ceil(reps * batchMs * 4 / 3 / Math.max(ms, 0.01))));
  }
  const samplesNs = [];
  for (let t = 0; t < trials; t++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < reps; i++) fn(arg);
    samplesNs.push(Number(process.hrtime.bigint() - t0) / reps);
  }
  return { reps, samplesNs, minNs: Math.min(...samplesNs), medianNs: median(samplesNs) };
}
