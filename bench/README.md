# Benchmarks

`run.mjs` is the progression dashboard for the Wasm backend. It sweeps the
existing workloads across their input sizes. The historical runner and the
optional TAST comparison share `suite.mjs` (workloads, sizes, expected results)
and `measure.mjs` (adaptive timing). The published JS/Wasm graph scripts and
their output formats remain separate, unchanged upstream workflows.

| Benchmark | Stresses |
| --- | --- |
| `fib` | Tree recursion and Int arithmetic |
| `sumLoop` | Tail loop and Prelude dictionary arithmetic |
| `qsort` | List quicksort, closures and allocations |
| `nqueens` | Backtracking and mutual local recursion |
| `bintreeDfs`, `bintreeBfs` | Tree traversals and a list queue |
| `mapFold`, `mapFoldArray` | Higher-order traversal of lists and arrays |
| `countEffect` | Effect instance dictionaries and constant-stack iteration |
| `curry` | Curried Int function dispatch |
| `polyInt` | Scalar recursive loop with a polymorphic use at its exit (branch addition) |

All entries expose an `Int -> Int` checksum interface. `CountEffect` and
`BenchCurry` use separate bundles; the other cases share `Bench.Main`.
`polyInt` does not guarantee boxing without TAST: inspect the generated worker.

## Existing workflow

Use the repository's `nix develop` environment and installed dependencies.
First build `purs-wasm`, `purwc`, `ulib-tooling`, the runtime and the ulib shadows
as in `.github/workflows/bench.yaml`. Then:

```sh
cd bench
npm test           # protocol checks; no fork or timing thresholds required
npm run build      # PureScript inputs and ALL THREE Wasm bundles, forced relink
npm run snapshot   # rebuild, measure, and render graphs using gnuplot
```

A snapshot writes `snapshots/<datetime>/{results.json,*.dat,*.png}`. It overlays
`snapshots/baseline.json`, when present. There is no automatic `latest` symlink.
New generated snapshots/results are ignored by Git; the existing tracked
baseline is retained. Published graphs are produced by the existing Benchmark
workflow and uploaded to GitHub Pages, not by committing snapshot images.

`npm run base` explicitly **replaces** `snapshots/baseline.json`; do not run it
to measure a proposed improvement against the existing reference. To record
measurements without graphs, use `node run.mjs snapshots/<new-name>` after a
build. The legacy JSON shape (`wasmBytes`, `node`, `benchmarks` with `nsPerOp`,
`ms`, `result`) and `.dat` columns remain compatible. `wasmBytes` still denotes
the main bundle only.

Each point is checked before and after timing against an independent expected
value; a historical checksum mismatch also fails. Missing bundles/exports and
malformed baselines fail instead of silently skipping a case. These are
observable-result checks, not a substitute for semantic compiler tests: for
example, quicksort's minimum-element checksum does not verify the whole list.

Historical timings retain the minimum of five adaptive batches after warmup.
A fresh module instance resets module state but does not isolate V8's GC heap.
Use a Node version with Wasm GC and tail-call support (the repository pins the
toolchain); do not compare historical times from different machines as if they
were paired measurements.

## Optional three-arm TAST comparison

This is an extension of `run.mjs`, not a second workload suite or a new baseline.
It is opt-in: ordinary builds and CI do not require the PureScript fork.

| Arm | Backend and input |
| --- | --- |
| U (`upstream`) | Clean, pinned upstream checkout; stock `purs` input |
| C (`control`) | Proposed branch; fresh fork input with type/usage facts erased |
| T (`typed`) | Same branch and fork input, with metadata retained |

Example, from the repository root, after preparing a separate upstream checkout
with its dependencies installed:

```sh
node bench/tast-proof.mjs \
  --upstream /absolute/path/to/clean-upstream \
  --stock-purs /absolute/path/to/stock/purs \
  --tast-purs /absolute/path/to/fork/purs \
  --output /absolute/path/to/new-experiment-directory
```

The output directory must not exist. The builder checks the upstream checkout
is clean and its ulib sources match the branch. Both backends are built with the
same stock compiler; program inputs and ulib shadows are generated afresh with
the respective frontends. It builds all three bundles in each arm with separate
input/output/lib/store directories and `--force`. Spago uses cached dependencies
in offline mode. The fork must emit annotation types with `--codegen corefn`;
absence of types in `Bench.Main` is an error.

C retains runtime syntax, including `TypeApp` wrappers, and normal optimisation
passes. Its input copy has annotation types, TypeApp type arguments, root
declaration/foreign type tables and annotation usage facts erased. This is a
documented **input ablation for the current reader**, not a stock-frontend
emulation or a permanent flag for future typed passes. Extend the ablation/tests
when the reader consumes new metadata. Pass-specific flags remain necessary
to attribute future optimisations independently.

The builder saves `manifest.json`, inputs, libraries, stores and bundles, then
invokes the shared entry point:

```sh
node bench/run.mjs --compare /absolute/path/to/manifest.json /new/report-directory
```

The report directory may exist, but `comparison.json` is never overwritten.
The default is all 11 cases / 59 sizes. `--benchmarks fib,polyInt` on the builder
is an explicitly recorded diagnostic subset, not evidence of suite-wide gains.

The protocol uses three repetitions in rotated U/C/T, C/T/U, T/U/C order, each
benchmark/arm/repetition in a new Node process (99 processes for the full suite).
This prevents one workload's allocations from changing the next one's GC state;
points within one workload still share their process. Each point uses ten warmup calls and seven calibrated
batches (target 30 ms). It records every sample and run median, the median of
the three run medians, and their quartiles. **Quartiles are descriptive spread,
not confidence intervals.** Timings include kernel calls, not build,
instantiation, or marshalling costs. End-to-end/compilation costs need separate
measurements before making claims about them.

`comparison.json` includes source revisions/dirty source hashes, frontend
versions/binary hashes, commands, input/library hashes, all bundle hashes/sizes,
Node/V8/Binaryen versions, machine/OS and raw measurements. Ratios above 1 mean
the denominator is faster:

- **U/T**: delivered pipeline comparison, including the frontend difference.
- **C/T**: incremental benefit of metadata in the controlled experiment.
- **U/C**: check whether the control itself differs/regresses from upstream.

Identical C/T bundles are a valid negative result: timing fluctuations between
identical bytes are not a TAST optimisation. Report regressions and all sizes,
not only the largest win. No speedup threshold is a CI assertion. Before a
performance claim, inspect the hot worker and callees; static allocation
instructions do not by themselves measure dynamic V8 allocations.

Measurements and implementation scope for the current recursive Int worker
experiment are documented in [`../TAST.md`](../TAST.md). Earlier reports without
`protocol.processIsolation` used one process for an entire arm and should not
be mixed with the per-benchmark protocol; their cross-workload effects can be large.

The historical `../altbak.pub/README.md` provides workload context, not a
comparable Wasm timing baseline: programs and measurement protocols differ.
Remaining correctness/PR gates and optimisation candidates are in `../todo.md`.
