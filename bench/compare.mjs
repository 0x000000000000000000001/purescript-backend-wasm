// Three-arm report, invoked by run.mjs --compare. It never changes baseline.json.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { benches, bundles, checkResult } from "./suite.mjs";
import { measure, median } from "./measure.mjs";

export const arms = ["upstream", "control", "typed"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export function validateManifest(m) {
  if (m.schemaVersion !== 1) throw new Error("Expected comparison manifest schemaVersion 1");
  for (const arm of arms) {
    const v = m.variants?.[arm];
    if (!v?.revision || !v?.frontend || !v?.inputHash) throw new Error(`Missing provenance for ${arm}`);
    for (const bundle of Object.keys(bundles)) {
      if (typeof v.bundles?.[bundle] !== "string") throw new Error(`Missing ${arm}/${bundle} bundle path`);
    }
  }
  if (m.benchmarks && (!Array.isArray(m.benchmarks) || !m.benchmarks.length ||
      new Set(m.benchmarks).size !== m.benchmarks.length ||
      m.benchmarks.some(name => !benches.some(b => b.name === name)))) throw new Error("Invalid benchmark selection");
  return m;
}

function load(manifestPath, arm) {
  const m = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const bytes = {}, artifacts = {};
  for (const [key, path] of Object.entries(m.variants[arm].bundles)) {
    bytes[key] = readFileSync(resolve(dirname(manifestPath), path));
    artifacts[key] = { sha256: sha256(bytes[key]), bytes: bytes[key].length };
  }
  return { m, bytes, artifacts };
}

export function selectBenchmarks(m, name) {
  const selected = benches.filter(b => !m.benchmarks || m.benchmarks.includes(b.name));
  if (name !== undefined && !selected.some(b => b.name === name)) throw new Error(`Benchmark not selected: ${name}`);
  return name === undefined ? selected : selected.filter(b => b.name === name);
}

async function worker(manifestPath, arm, name) {
  const { m, bytes, artifacts } = load(manifestPath, arm);
  const results = [];
  for (const b of selectBenchmarks(m, name)) {
    const points = [];
    for (const size of b.sizes) {
      const { instance } = await WebAssembly.instantiate(bytes[b.bundle ?? "main"], {});
      instance.exports.caf_init?.();
      const fn = instance.exports[b.fn ?? b.name];
      if (typeof fn !== "function") throw new Error(`Missing export ${b.fn ?? b.name}`);
      const result = fn(size);
      checkResult(b, size, result);
      const timing = measure(fn, size, { trials: 7 });
      checkResult(b, size, fn(size));
      points.push({ size, result, ...timing });
    }
    results.push({ name: b.name, points });
  }
  return { arm, artifacts, benchmarks: results };
}

function spread(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = p => {
    const i = p * (sorted.length - 1), lo = Math.floor(i);
    return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
  };
  return { medianNs: median(values), q1Ns: q(0.25), q3Ns: q(0.75), runMediansNs: values };
}

export async function compare(manifestPath, outputDir) {
  if (!manifestPath || !outputDir) throw new Error("Usage: node run.mjs --compare manifest.json output-dir");
  manifestPath = resolve(manifestPath);
  const reportPath = resolve(outputDir, "comparison.json");
  if (existsSync(reportPath)) throw new Error(`Refusing to overwrite ${reportPath}`);
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const artifacts = Object.fromEntries(arms.map(arm => [arm, load(manifestPath, arm).artifacts]));
  const rawRuns = [];
  const selected = selectBenchmarks(manifest);
  // Each arm occupies each position once. Isolate each workload as well as each
  // arm: a preceding allocation-heavy benchmark changes V8's shared heap state.
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const b of selected) {
      console.log(`repeat ${repeat + 1}/3: ${b.name} (three isolated arms)`);
      for (let position = 0; position < arms.length; position++) {
        const arm = arms[(position + repeat) % arms.length];
        const raw = execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", manifestPath, arm, b.name],
          { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
        const run = JSON.parse(raw);
        if (JSON.stringify(run.artifacts) !== JSON.stringify(artifacts[arm])) throw new Error(`Artifacts changed during ${arm} measurement`);
        rawRuns.push({ repeat, position, ...run });
      }
    }
  }
  const results = selected.map(b => ({ name: b.name, points: b.sizes.map(size => {
    const timings = Object.fromEntries(arms.map(arm => [arm, spread(rawRuns.filter(r => r.arm === arm && r.benchmarks.some(x => x.name === b.name)).map(r =>
      r.benchmarks.find(x => x.name === b.name).points.find(p => p.size === size).medianNs))]));
    return { size, expected: b.expected(size), timings,
      upstreamOverTyped: timings.upstream.medianNs / timings.typed.medianNs,
      controlOverTyped: timings.control.medianNs / timings.typed.medianNs,
      upstreamOverControl: timings.upstream.medianNs / timings.control.medianNs };
  }) }));
  const out = {
    schemaVersion: 1, timestamp: new Date().toISOString(), manifest, artifacts,
    environment: { node: process.version, v8: process.versions.v8, platform: platform(), arch: arch(), os: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    measurementSources: Object.fromEntries(["run.mjs", "compare.mjs", "measure.mjs", "suite.mjs"].map(name =>
      [name, sha256(readFileSync(new URL(name, import.meta.url)))])),
    protocol: { repetitions: 3, warmup: 10, trials: 7, calibrationMs: 30,
      processIsolation: "one fresh Node process per benchmark, arm and repetition",
      statistic: "median of three independent-process run medians; quartiles describe those three medians, not confidence intervals",
      scope: "kernel calls only; build, instantiation and marshalling excluded; all legacy suite input sizes unless selection is explicit" },
    typedChangesCode: Object.keys(bundles).some(b => artifacts.control[b].sha256 !== artifacts.typed[b].sha256),
    benchmarks: results, rawRuns,
  };
  mkdirSync(resolve(outputDir), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(out, null, 2) + "\n", { flag: "wx" });
  for (const b of results) {
    const p = b.points.at(-1);
    console.log(`${b.name}: U/T=${p.upstreamOverTyped.toFixed(3)}x C/T=${p.controlOverTyped.toFixed(3)}x U/C=${p.upstreamOverControl.toFixed(3)}x (size ${p.size})`);
  }
  if (!out.typedChangesCode) console.log("Control and typed artifacts are identical: no generated-code benefit demonstrated.");
  console.log(`report: ${reportPath}`);
  return out;
}

if (process.argv[2] === "--worker") {
  console.log(JSON.stringify(await worker(process.argv[3], process.argv[4], process.argv[5])));
}
