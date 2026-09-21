import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { benches, bundles, checkResult } from "./suite.mjs";
import { measure, median } from "./measure.mjs";
import { annotationCount, eraseTast } from "./tast-input.mjs";
import { arms, selectBenchmarks, validateManifest } from "./compare.mjs";

test("independent expected values agree with every historical checksum", () => {
  const baseline = JSON.parse(readFileSync(new URL("snapshots/baseline.json", import.meta.url)));
  let checked = 0;
  for (const b of benches) {
    for (const p of baseline.benchmarks.find(x => x.name === b.name)?.points ?? []) {
      checkResult(b, p.size, p.result, p);
      checked++;
    }
  }
  assert.ok(checked > 0);
});

test("bad results and inconsistent historical checksums fail closed", () => {
  const fib = benches.find(b => b.name === "fib");
  checkResult(fib, 10, 55);
  assert.throws(() => checkResult(fib, 10, 54), /expected 55/);
  assert.throws(() => checkResult(fib, 10, 55, { result: 54 }), /historical checksum/);
  assert.throws(() => checkResult(fib, 10, NaN), /expected 55/);
});

test("median retains raw samples and rejects invalid data", () => {
  const samples = [3, 1, 4, 2];
  assert.equal(median(samples), 2.5);
  assert.deepEqual(samples, [3, 1, 4, 2]);
  assert.equal(median([5, 1, 2]), 2);
  assert.throws(() => median([]));
  assert.throws(() => median([Infinity]));
  assert.throws(() => median([NaN]));
});

test("measurement stores each trial with its calibrated repetition count", () => {
  let calls = 0;
  const result = measure(n => { calls += n; }, 1, { warmup: 2, trials: 3, batchMs: 1 });
  assert.equal(result.samplesNs.length, 3);
  assert.ok(result.reps >= 1);
  assert.ok(calls >= 2 + 3 * result.reps);
  assert.equal(result.minNs, Math.min(...result.samplesNs));
  assert.equal(result.medianNs, median(result.samplesNs));
});

test("TAST ablation preserves runtime syntax and standard metadata without mutating input", () => {
  const input = { typeTable: [], dataDecls: [], classDecls: [], foreignAnnotations: [],
    decls: [{ type: "TypeApp", typeArgument: { type: "Int" },
      annotation: { type: 0, bindingUsage: {}, variableUse: {}, meta: { constructor: true }, sourceSpan: {} },
      expression: { type: "Var", value: "id", annotation: { type: { type: "Int" } } } }] };
  const original = structuredClone(input);
  const out = eraseTast(input);
  assert.deepEqual(input, original);
  assert.equal(annotationCount(input), 2);
  assert.equal(annotationCount(out), 0);
  assert.deepEqual(Object.keys(out), ["decls"]);
  assert.equal(out.decls[0].type, "TypeApp");
  assert.equal(out.decls[0].expression.value, "id");
  assert.deepEqual(out.decls[0].typeArgument, { type: "Unknown" });
  assert.deepEqual(out.decls[0].annotation, { meta: { constructor: true }, sourceSpan: {} });
});

test("real compiler fixtures remain structurally equal after idempotent ablation", () => {
  const real = JSON.parse(readFileSync(new URL("../compiler/test/fixtures/TastArray.corefn.json", import.meta.url)));
  assert.ok(annotationCount(real) > 0);
  const control = eraseTast(real);
  assert.equal(annotationCount(control), 0);
  assert.deepEqual(eraseTast(control), control);
  assert.deepEqual(control.exports, real.exports);
  assert.deepEqual(control.imports, eraseTast({ imports: real.imports }).imports);
});

test("comparison requires three complete arms and a valid explicit selection", () => {
  const manifest = { schemaVersion: 1, variants: Object.fromEntries(arms.map(arm =>
    [arm, { revision: "abc", frontend: "purs", inputHash: "123",
      bundles: Object.fromEntries(Object.keys(bundles).map(b => [b, `${arm}/${b}.wasm`])) }])) };
  assert.equal(validateManifest(manifest), manifest);
  assert.throws(() => validateManifest({ ...manifest, schemaVersion: 2 }));
  for (const arm of arms) {
    const missing = structuredClone(manifest);
    delete missing.variants[arm];
    assert.throws(() => validateManifest(missing), /Missing provenance/);
    delete manifest.variants[arm].bundles.main;
    assert.throws(() => validateManifest(manifest), /bundle path/);
    manifest.variants[arm].bundles.main = `${arm}/main.wasm`;
  }
  for (const benchmarks of [[], ["unknown"], ["fib", "fib"], "fib"]) {
    assert.throws(() => validateManifest({ ...manifest, benchmarks }), /Invalid benchmark selection/);
  }
  validateManifest({ ...manifest, benchmarks: ["fib", "polyInt"] });
});

test("a measurement worker isolates exactly one selected benchmark", () => {
  assert.equal(selectBenchmarks({}).length, benches.length);
  assert.deepEqual(selectBenchmarks({}, "fib").map(b => b.name), ["fib"]);
  assert.deepEqual(selectBenchmarks({ benchmarks: ["polyInt"] }, "polyInt").map(b => b.name), ["polyInt"]);
  assert.throws(() => selectBenchmarks({}, "unknown"), /not selected/);
  assert.throws(() => selectBenchmarks({ benchmarks: ["fib"] }, "polyInt"), /not selected/);
});
