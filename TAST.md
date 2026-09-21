# TAST-driven recursive Int workers

This note documents a personal experiment on the `tast` branch, not a PR
proposal or a claim that TAST makes every program faster. No PR is currently
planned. For a short overview, see the [performance progress summary](README.md#tast-performance-progress).
The implementation consumes the local PureScript fork's typed
CoreFn directly, through the Wasm backend's existing reader and optimiser. PBO
is not a new build dependency and was not changed for this experiment.

## What changes

The default separately compiled pipeline deliberately gives module-visible
functions a boxed ABI. The worker cannot see all callers, so changing that ABI
from a source annotation would break separately compiled clients.

The type information is nevertheless present: in the real `Bench.Main.pmi`,
the lifted local `polyInt.loop` still has `Int -> Int -> Int`. Previously its
arguments and result were boxed when lowering pinned the module boundary.

[`Lower/TypedWorkers.purs`](compiler/src/PureScript/Backend/Wasm/Lower/TypedWorkers.purs)
now splits eligible functions after ANF lowering, before the existing
representation solver:

- Keep the original module-visible function and its boxed calling convention.
- Move its body into a fresh, private worker with `i32` arguments and result.
- Redirect saturated local calls, including the recursive edge, to that worker.
- Leave closure layouts, unknown applications, imports and public wrappers on
  their existing conventions. A public call unboxes/boxes at the boundary;
  recursive internal calls do not repeatedly cross it.

Eligibility is intentionally small: a non-nullary function with a complete
`Int -> ... -> Int` annotation, matching runtime arity, a boxed module ABI and
a direct self-recursive call, without an opaque closure application in its
body. This includes `RApply` and callback intrinsics (`runFn`/`runEffectFn`,
`unsafePartial`, `fromNumberImpl`, reference callbacks and effect loops).
The profitability check traverses branches, defaults, joins and continuations;
it is conservative even when a rejected application might be cold. It is not
an interprocedural cost model or a proof that every remaining split is faster.
There is at most one worker per function. Names
are collision-checked. The original body is moved, not duplicated at each call.

Nonrecursive functions, mutual-only recursion, incomplete/polymorphic signatures,
hidden-argument arity mismatches, `Number`, arrays and records fall back. A
lambda lift with captures currently drops its transformed signature; this pass
does not guess the capture types. No ownership/mutation permission is inferred
from usage annotations. No dictionary implementation or function identity is
inferred from a type, and no new array layout is introduced.

This is not general monomorphisation. Some top-level facts could also be
recovered from externs or a stronger analysis; the demonstrated advantage is
using the already available type of a local lifted function. The pass has no
benchmark-name checks. Stock CoreFn remains supported; without eligible type
facts the pass returns the existing IR unchanged.

The change lives in the existing per-module lowering path, including the shared
worker context. It does not make dependencies depend on their consumers. `.pmi`
layout is unchanged by this pass; backend cache tag **6** invalidates objects
from the earlier code-generation policy.

## Measurements (closure-call guard, cache tag 6)

The current pass gives **3.43× C/T on upstream Fibonacci** and
**1.68× C/T on the local `polyInt` probe** at their largest inputs.
The earlier curry code-generation regression is removed: its C/T bundles are
now byte-identical, and its measured C/T ratio is 1.012 (near parity). The typed
main bundle is unchanged from the previous fast version. This is a local gain,
**not 10×**, not an application-wide improvement or a statistical proof of
performance equivalence on every workload.

U = clean upstream; C = proposed backend with metadata ablated; T = same
backend with metadata retained (details below). A ratio above 1 favours T.
These are all workloads, each at its largest size; times are milliseconds.

| Workload | Size | U ms | C ms | T ms | U/T | C/T |
| --- | --- | --- | --- | --- | --- | --- |
| fib | 28 | 2.9729 | 2.9456 | 0.8600 | 3.457 | 3.425 |
| sumLoop | 1000000 | 1.3994 | 1.4540 | 1.4856 | 0.942 | 0.979 |
| qsort | 3000 | 0.5031 | 0.4926 | 0.4951 | 1.016 | 0.995 |
| nqueens | 9 | 1.0424 | 1.0832 | 1.0597 | 0.984 | 1.022 |
| bintreeDfs | 17 | 1.5092 | 1.5226 | 1.5544 | 0.971 | 0.980 |
| bintreeBfs | 12 | 32.0054 | 31.9508 | 32.1619 | 0.995 | 0.993 |
| mapFold | 500 | 2.1041 | 2.1236 | 2.1174 | 0.994 | 1.003 |
| mapFoldArray | 500 | 1.5779 | 1.5533 | 1.5080 | 1.046 | 1.030 |
| countEffect | 64000 | 0.0801 | 0.0795 | 0.0732 | 1.094 | 1.086 |
| curry | 800000 | 44.7731 | 44.7275 | 44.1861 | 1.013 | 1.012 |
| polyInt | 6400000 | 3.5399 | 3.5533 | 2.1161 | 1.673 | 1.679 |

The two positive cases retain their advantage across every measured size:

| Workload | Size | U/T | C/T |
| --- | --- | --- | --- |
| fib | 20 | 3.409 | 3.425 |
| fib | 22 | 3.407 | 3.415 |
| fib | 24 | 3.439 | 3.433 |
| fib | 26 | 3.438 | 3.431 |
| fib | 28 | 3.457 | 3.425 |
| polyInt | 100000 | 1.736 | 1.686 |
| polyInt | 200000 | 1.713 | 1.677 |
| polyInt | 400000 | 1.693 | 1.718 |
| polyInt | 800000 | 1.693 | 1.756 |
| polyInt | 1600000 | 1.675 | 1.668 |
| polyInt | 3200000 | 1.677 | 1.710 |
| polyInt | 6400000 | 1.673 | 1.679 |

The three independent-process medians at the largest size are listed below.
All observations are retained; headline ratios use the median of the three,
not the slowest control or the fastest typed observation.

| Workload | Arm | Run 1 ms | Run 2 ms | Run 3 ms |
| --- | --- | --- | --- | --- |
| fib | U | 2.9521 | 2.9813 | 2.9729 |
| fib | C | 2.9663 | 2.9456 | 2.9409 |
| fib | T | 0.8523 | 0.8600 | 0.8707 |
| curry | U | 44.5244 | 44.9546 | 44.7731 |
| curry | C | 44.9609 | 44.3745 | 44.7275 |
| curry | T | 44.1861 | 43.8705 | 44.8402 |
| polyInt | U | 3.5399 | 3.7669 | 3.5125 |
| polyInt | C | 3.5181 | 4.0371 | 3.5533 |
| polyInt | T | 2.1290 | 2.1161 | 2.1019 |

`curry` and `countEffect` are **byte-identical** in C/T despite respective
measured ratios of 1.012 and 1.086. Those apparent gains are not TAST
generated-code benefits; the earlier report even measured a slowdown for
the unchanged Effect binary. Small ratios near 1 elsewhere, including
negative ones, are reported as observations, not new optimisation claims.
No suite-wide non-regression claim follows from three repetitions.

### Generated-code evidence

The C and T main bundles are byte-identical to their respective cache-tag-5
counterparts. The previously inspected hot workers therefore retain these
signatures and instruction counts:

| Function | C signature | T signature | Static `struct.new` sites C → T |
| --- | --- | --- | --- |
| Fibonacci (`$177`) | `(ref $3) -> (ref $3)` | `i32 -> i32` | 3 → 0 |
| `polyInt.loop` (`$168`) | `(ref $3, ref $3) -> eqref` | `(i32, i32) -> i32` | 3 → 0 |

Both T workers call themselves with native `i32` values; the `polyInt` edge
remains a direct `return_call`. There are no indirect `call_ref` instructions
in either hot worker in C or T. The gain is therefore not newly discovered
direct dispatch: the relevant change removes scalar boxing on those edges.
These are static instruction counts, **not measured allocations per iteration**.
Function numbers are specific to these artifacts; structural tests use names
and signatures instead.

| Bundle | U bytes | C bytes | T bytes |
| --- | --- | --- | --- |
| main | 26703 | 24321 | 24170 |
| countEffect | 4758 | 4583 | 4583 |
| curry | 7467 | 6789 | 6789 |

The main bundle shrinks by 151 bytes C→T. Curry and Effect have no C→T size
change. Full hashes are in the raw report; the main-bundle SHA-256 identities
are:

- C: `168db81d7f16cdbad55f7129e3166c7c0f79426b71fc1122e39e2e7720c7143d`.
- T: `190ff8e36328ebbc31a29f8cc8c168e462d4c1c5de347dee98886c8f8c551923`.

### Recorded experiment

- Completed 2026-09-21T15:23:48.932Z; **99 fresh processes / 531 measured points**,
  all expected-result checks passed.
- [Raw samples and summaries](bench/results/tast-closure-guard-20260921/comparison.json)
  and [build manifest](bench/results/tast-closure-guard-20260921/manifest.json)
  are retained locally as generated artifacts, not tracked benchmark baselines.
- Backend: `opt/tast-guided-unboxing`, HEAD
  `903efe22613a3e178b299d7a413bd42ea6cded87` **plus uncommitted changes**.
  The manifest's measured source identity is
  `39e21b371ab54434ff53a1a07a95acb8de525d0cdb8d0208dbae0aa866f67aa4`.
  Subsequent result-documentation edits are not included in that source hash.

## Attribution and protocol

All arms use identical benchmark sources and library sources. The suite contains
the ten upstream cases plus the branch's `polyInt` probe; the Fibonacci workload
is an existing upstream case, not a workload added to demonstrate this pass.

| Arm | Meaning |
| --- | --- |
| U | Clean upstream backend at `9c978a2cd48aa862bb3515be5c753f603b3e0c4e`, stock purs 0.15.16 inputs |
| C | Proposed backend, fresh fork inputs with TAST metadata erased |
| T | Same proposed backend and fork inputs, metadata retained |

C preserves runtime syntax (including TypeApp wrappers), normal optimisation
passes, and the same externs files as T. The ablation removes annotation types,
TypeApp type arguments, declaration/foreign type tables and annotation usage
facts. **C/T measures incremental metadata benefit; U/T includes the frontend
difference and the rest of the experimental branch.** Neither is a comparison
against an optimiser intentionally disabled to force boxing.

The fork executable reports commit `319e138cbcbee59b3837f6cba7ca03a680395e67`
(purs 0.15.16); its executable SHA-256 is
`d897d0c85746bdaa06de0fd5c209f712aabd3450f23707d1cd1f44fd0de2e275`.
Both backends are built using the same official purs 0.15.16 executable.
Inputs and library shadows are regenerated separately, with isolated stores
and forced builds. The manifest records revisions, dirty-source identity,
commands, input/library hashes, executable versions and all artifact hashes.

The shared `bench/run.mjs --compare` runner uses all 11 workloads / 59 sizes,
three repetitions, and rotated U/C/T, C/T/U, T/U/C order. Each benchmark, arm
and repetition runs in a **fresh Node process** (99 processes). Each point
uses a fresh module instance, ten warmup calls and seven adaptive timing
batches targeting 30 ms. Expected results are checked before and after timing.

Reported times are medians of three process medians; quartiles/ranges describe
those observations, not confidence intervals. Raw samples are retained. These
are kernel-call timings, including the existing call boundary, not build time,
module instantiation or complete application latency. Dynamic allocations,
peak memory and compilation-cost changes have not been measured.

The machine is an Apple M4 Pro (14 logical CPUs), Darwin 25.1.0/arm64, Node
24.8.0, V8 13.6.233.10-node.27, Binaryen 123.0.0, Spago 1.0.3. The machine was
not frequency-pinned or reserved exclusively for the experiment. Small timing
differences are not reliable optimisation claims. Other-machine/engine
replication is required before generalising these numbers.

### Experiments retained, not silently replaced

The broader first attempt also split nonrecursive Int functions. Across two
whole-arm-process runs, `fib(28)` measured 3.40–3.59× C/T and `polyInt(6400000)`
1.45–1.55× C/T. The first implementation also showed inconsistent or negative
results on curry dispatch, so the final pass was narrowed to self-recursion.

Those runs exposed a measurement issue: `sumLoop`'s export and transitive loop
were identical WAT in C/T, yet measured 0.890× then 0.798× C/T after other
workloads. With the same artifacts and the preceding workloads excluded, the
ratio became 1.001×. This demonstrates suite-context sensitivity, not a new
`sumLoop` optimisation. The paired runner now isolates workloads in separate
processes; the legacy snapshot format/workflow is unchanged.

The earlier diagnostic reports remain under
`bench/results/tast-int-workers-20260921/` (`comparison.json`,
`confirmation/comparison.json`, `isolated/comparison.json`, and
`per-benchmark/comparison.json`). They are not the final-pass measurements and
must not be pooled with them or quoted as gains from the narrower patch.

### Follow-up: closure-call profitability guard

The self-recursive-only pass (cache tag 5), recorded in
`bench/results/tast-recursive-int-20260921/comparison.json`, still made
`curry(800000)` take 10.1% longer than C. Its loop retained four indirect
`call_ref` sites. In C, the boxed loop argument was reused both for a captured
closure and as a call argument. The typed worker rebuilt boxes for these uses.
Scalar signatures alone therefore did not establish a profitable region. This
explains the reboxing trade-off in the generated code; it is not a measurement
of allocation/GC costs or a claim to have isolated every V8-level cause.

The new guard rejects remaining `RApply` and closure-calling intrinsics. A
first probe covering only `RApply` restored the curried loop but missed its
uncurried counterpart, whose calls are represented by `RunEffectFn`. The final
guard covers both forms, `UnsafePartial` and the other native callback
intrinsics. This is a general IR rule, not a check for a benchmark/module name.
It leaves ordinary scalar primitives and direct recursion eligible. A future
boxing-reuse or interprocedural cost analysis can relax this conservative rule.

The rebuilt curry C/T bundles are byte-identical, including both dispatch
exports; their SHA-256 is
`e3cc930b924127f3955e4dafe13cb02ce4ad72eb3a3f15299af0bf7e39d81cf7`.
The typed main bundle and every control bundle are also byte-identical to
their cache-tag-5 counterparts. Thus the problematic transformation is removed
without changing the generated code of the two positive witnesses or weakening
the control. Timing is repeated independently; reports are not pooled.

## Semantic and structural checks

The unit regression was observed failing before the worker implementation.
Structural tests check the boxed public signature, private `i32` signature,
recursive call target, fresh naming, metadata/arity fallbacks and the exclusion
of nonrecursive leaf functions. Representation inference without TAST remains
enabled and covered by its existing tests.

The closure guard adds 28 structural tests: opaque calls in nine control-flow
positions, the corresponding direct-recursion positive controls, nine
callback intrinsics, and an ordinary scalar-primitive positive control. The
18 rejection cases were observed failing before their respective guard was
added. These are IR-classification tests; runtime checks below exercise the
compiler and real generated programs separately.

Real fork fixtures in `compiler/test/fixtures/TastInt*.corefn.json`, with their
generating `.purs.sample` files, exercise the actual JSON contract. The runtime
test `compiler/test/typedWorkers.mjs` checks recursive loops, local lifting,
mutual-recursion fallback, partial/stored closures, join values, signed Int32
overflow and separately compiled calls from both typed and stock clients.
It runs in default, no-opt, legacy, legacy/no-opt and legacy/per-module modes.
The CI needs no fork executable because the real fixtures are checked in.

Validation of the measured implementation with the toolchain above:

- Compiler unit tests: **217/217**.
- Shared CLI unit tests: **30/30**.
- Existing E2E prebuild: **53 fixtures rebuilt**; E2E tests: **156/156**.
- Real typed-worker/interop runtime checks: **435 assertions**, across 15
  builds in the five modes above, including stock-client/typed-library calls.
- Real typed-array runtime guard: **5/5 modes**, all returning 42.
- Additional real-bundle dispatch probe: **76 checks** across curried and
  uncurried exports, inputs 0–32 and all five benchmark sizes, against the
  suite's independent expected values.
- Benchmark protocol tests: **8/8**.
- PureScript formatting, JavaScript syntax and `git diff --check`: passed.

Commands were `spago test -p compiler --offline --monochrome`,
`spago test -p cli-lib --offline --monochrome`,
`node compiler/test/e2eCliPrebuild.mjs`,
`spago test -p compiler -m Test.E2E.Cli --offline --monochrome`,
`node compiler/test/typedWorkers.mjs`, `node compiler/test/typedArrays.mjs`,
and `node --test bench/test.mjs`, with stock purs 0.15.16 and Spago 1.0.3 on
PATH. The E2E prebuild uses the existing installed ulib; the performance
experiment instead builds its own fresh, isolated library shadows.

The fixture-source build reports seven unused-import warnings in files that
are unchanged from upstream (`Bnd`, `Erased`, `Euclid`, `Fld`, `Mon`, `Rec`).
Compiler and CLI builds/tests introduce no warnings in this run. The complete
matrix is still needed; a green targeted run is not a blanket clean-CI claim.

This is **not full pinned-environment CI validation**: Nix is unavailable on
this host, formatting used purs-tidy 0.11.1 rather than the Nix pin 0.10.0,
and the complete bin-test/CI matrix was not rerun after this optimisation.
The new runtime guard is included in the existing `compiler/test:bin` chain.
An unrelated legacy Spago in the parent `node_modules/.bin` shadows the correct
tool under npm, so the commands above were run directly; upstream scripts and
global installations were not modified to mask it.

Before proposing a merge: reproduce on the pinned toolchain and another
engine/machine, review the conservative profitability policy and the inherited
branch diff and cache/dependency behaviour, and attach the raw measurements.

## Reproduce

Prepare two checkouts with their pinned dependencies installed: the branch
under test and a **clean** upstream checkout at the above commit. Use the
repository's pinned environment for a PR reproduction; do not change the
upstream toolchain scripts to accommodate an unrelated global installation.

```sh
node bench/tast-proof.mjs \
  --upstream /absolute/path/to/clean-upstream \
  --stock-purs /absolute/path/to/stock/purs \
  --tast-purs /absolute/path/to/fork/purs \
  --output /absolute/path/to/new-results-directory
```

The output directory must not exist. This rebuilds the tools, program inputs,
library shadows and all three bundles per arm, then invokes the unified runner.
To repeat timing of the exact saved artifacts without rebuilding:

```sh
node bench/run.mjs --compare /path/to/manifest.json /new/report-directory
```

See [bench/README.md](bench/README.md) for the legacy snapshot workflow and the
precise ablation contract. Historical `altbak.pub` baselines informed workload
context only: their different programs/protocols are not used as equivalent
Wasm measurements. Generated reports remain ignored, following upstream's
convention; attach the raw JSON and manifest to the eventual PR and rerun after
the final source commits. No public PR or performance publication was created
by this local experiment.
