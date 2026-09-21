// Benchmark runner for the wasm backend. For each `Int -> Int` entry of the
// self-contained wasm bundles, it sweeps a range of input sizes and times
// each, so the result is a time-vs-input curve per benchmark. Results are recorded
// to JSON (and, in snapshot mode, one gnuplot data file per benchmark) so
// optimization work can be measured against this baseline.
//
//   build:    npm run build
//   baseline: npm run base        -> snapshots/baseline.json (explicit replacement)
//   snapshot: npm run snapshot    -> snapshots/<datetime>/{results.json,*.dat,*.png}
//
// Each entry returns a checksum/result, recorded per point so a before/after
// comparison can confirm the computation is unchanged. The wasm is self-contained
// (runtime merged), so it instantiates with no imports (Node 22+).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { benches, bundles, checkResult } from "./suite.mjs";
import { measure } from "./measure.mjs";

if (process.argv[2] === "--compare") {
  if (process.argv.length !== 5) throw new Error("Usage: node run.mjs --compare manifest.json output-dir");
  const { compare } = await import("./compare.mjs");
  await compare(process.argv[3], process.argv[4]);
  process.exit(0);
}
if (process.argv.length > 3 || process.argv[2]?.startsWith("--")) throw new Error("Usage: node run.mjs [snapshot-dir] | --compare manifest.json output-dir");

// The benchmark wasm bundles. `Bench.Main` is the shared algorithmic suite; the
// Effect-monad (CountEffect) and curry-dispatch (BenchCurry) benchmarks are separate
// entries (their own bundles) but baselined here too — their optimizations (Effect
// collapse, curried-call cost) are fragile and must be caught by a regression check.
const bundleBytes = Object.fromEntries(Object.entries(bundles).map(([key, b]) => {
  const path = fileURLToPath(new URL(`./${b.directory}/index.wasm`, import.meta.url));
  if (!existsSync(path)) throw new Error(`Missing required ${key} bundle: ${path}. Run npm run build.`);
  return [key, readFileSync(path)];
}));
const bytes = bundleBytes.main;

// Fresh module state per point. V8's GC heap is still shared within this process;
// the comparison mode additionally repeats each arm in fresh processes.
async function freshFn(b) {
  const { instance } = await WebAssembly.instantiate(bundleBytes[b.bundle ?? "main"], {});
  instance.exports.caf_init?.();
  const fn = instance.exports[b.fn ?? b.name];
  if (typeof fn !== "function") throw new Error(`Missing export ${b.fn ?? b.name}`);
  return fn;
}

// The baseline (set by `npm run base`), if any: a `name -> size -> point` lookup that
// snapshots overlay and compare against.
const baselinePath = fileURLToPath(new URL("./snapshots/baseline.json", import.meta.url));
let baseline = null;
if (existsSync(baselinePath)) {
  try {
    baseline = {};
    for (const b of JSON.parse(readFileSync(baselinePath, "utf8")).benchmarks) {
      baseline[b.name] = Object.fromEntries(b.points.map((p) => [p.size, p]));
    }
  } catch (error) {
    throw new Error(`Invalid baseline ${baselinePath}: ${error.message}`);
  }
}

const fmt = (ns) =>
  ns >= 1e6 ? `${(ns / 1e6).toFixed(1)}ms` : ns >= 1e3 ? `${(ns / 1e3).toFixed(1)}us` : `${ns.toFixed(0)}ns`;

console.log(`wasm: ${bytes.length} bytes  (Bench.Main bundle)\n`);

const results = [];
for (const b of benches) {
  const points = [];
  for (const size of b.sizes) {
    const fn = await freshFn(b);
    const result = fn(size);
    checkResult(b, size, result, baseline?.[b.name]?.[size]);
    const ns = measure(fn, size).minNs;
    checkResult(b, size, fn(size));
    points.push({ size, nsPerOp: Math.round(ns), ms: Number((ns / 1e6).toFixed(4)), result });
  }
  results.push({ name: b.name, desc: b.desc, points });
  console.log(`${b.name.padEnd(11)} ${points.map((p) => `${p.size}:${fmt(p.nsPerOp)}`).join("  ")}`);
}

const out = { wasmBytes: bytes.length, node: process.version, benchmarks: results };

// Optional snapshot directory (argv[2]): write results.json + one gnuplot data
// file per benchmark (`<name>.dat`, rows "size ms"). With no argument, write the
// tracked snapshots/baseline.json.
const argDir = process.argv[2];
if (argDir) {
  const dir = resolve(argDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/results.json`, JSON.stringify(out, null, 2) + "\n");
  // each .dat: "size  baseline-ms  current-ms"  (baseline = NaN when absent, which
  // gnuplot skips), so the graph overlays the baseline curve and the current one.
  for (const b of results) {
    const base = baseline?.[b.name] ?? {};
    const dat = b.points.map((p) => `${p.size} ${base[p.size]?.ms ?? "NaN"} ${p.ms}`).join("\n") + "\n";
    writeFileSync(`${dir}/${b.name}.dat`, "# input-size  baseline-ms  current-ms\n" + dat);
  }
  console.log(`\nwrote ${dir}/results.json + ${results.length} *.dat files`);
  // speedup vs baseline at the largest input
  if (baseline) {
    console.log("\nvs baseline (largest input):");
    for (const b of results) {
      const last = b.points[b.points.length - 1];
      const base = baseline[b.name]?.[last.size]?.ms;
      if (base != null) {
        console.log(`  ${b.name.padEnd(11)} ${base.toFixed(1)}ms -> ${last.ms.toFixed(1)}ms  (${(base / last.ms).toFixed(2)}x)`);
      }
    }
  }
} else {
  const dir = fileURLToPath(new URL("./snapshots", import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/baseline.json`, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${dir.replace(process.cwd() + "/", "")}/baseline.json  (baseline set)`);
}
