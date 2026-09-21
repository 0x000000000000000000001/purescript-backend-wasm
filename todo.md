# TAST performance roadmap

Reviewed 2026-09-21. Working branch: `opt/tast-guided-unboxing`.

## Latest: closure-call profitability guard (2026-09-21)

- Investigated the curry regression in the actual WAT. Its four indirect
  calls remain; scalar loop arguments are reboxed for closure captures/calls
  instead of reusing the existing box. This is a representation trade-off,
  not evidence that every Int recursion benefits from a scalar worker.
- Added a conservative, module-independent eligibility rule: do not split
  functions whose bodies still contain `RApply` or a closure-calling native
  intrinsic. Cover uncurried `runFn`/`runEffectFn`, partial thunks and native
  callbacks too, including calls under branches, defaults and joins. No
  benchmark-name exception, public ABI change or inference suppression.
- Backend cache tag is now **6**; `.pmi` remains version 3. Curry C/T bundles
  are **byte-identical** again. The typed main bundle and all control bundles
  are unchanged from the previous experiment, preserving the two witnesses.
- Full fresh U/C/T run: **11 workloads / 59 sizes / 99 processes / 531 checked
  measurement points**. At maximum inputs, Fibonacci is **3.425× C/T and
  3.457× U/T**; `polyInt` is **1.679× C/T and 1.673× U/T**. Curry measures
  **1.012× C/T**, but identical code means this small variation is not a gain.
  All cases, including negative/noisy ratios, are reported in [TAST.md](TAST.md).
- Final report: `bench/results/tast-closure-guard-20260921/comparison.json`.
  Previous reports and upstream baselines are preserved, not overwritten or
  pooled. The before/after diagnosis is recorded alongside the current results.
- Added **28 structural tests**, with the rejection cases observed failing
  before the guard. Compiler **217/217**, CLI **30/30**, E2E **156/156** after
  rebuilding 53 fixtures; real typed-worker/interop **435 assertions**, arrays
  **5 modes**, protocol **8/8**, plus **76 checks** of both real curry exports.
  Formatting and diff checks pass. The seven fixture import warnings are in
  unchanged upstream files; full pinned CI and PR-scope review remain open.

This closes the observed curry code-generation regression by a conservative
fallback, not by optimising opaque dispatch itself. Before broadening the
worker pass, profile the next candidate (for example a closed-record numeric
accumulator), retain U/C/T attribution and include representation-boundary
costs. Do not generalise the measured scalar wins or promise 10×.

## Progress: first measured TAST worker gain (2026-09-21)

The latest user priority is an implemented, measured TAST benefit documented
for the future PR. [TAST.md](TAST.md) now contains the implementation contract,
full-suite results, raw-report locations, generated-code evidence, reproduction
commands and unresolved gates. This local experiment does not close the
earlier upstream-readiness checklist or promise a merge-ready branch.

- Executed the concrete-type trace: `polyInt.loop` remains `Int -> Int -> Int`
  in the real `.pmi`. The default module ABI pins, not lost type information,
  keep it boxed. Preserve these pins for separately compiled clients.
- Added `Lower/TypedWorkers.purs` before representation inference: a boxed
  wrapper plus one private `i32` worker for fully Int, directly self-recursive
  functions. Saturated local/recursive calls target the worker; closures,
  unknown applications and public/imported conventions are preserved.
  No general monomorphiser, PBO dependency or frontend change was needed.
- Narrowed the first broad worker experiment to self-recursion. Nonrecursive
  leaves and unsupported types/arity fall back. Backend cache tag **5** now
  supersedes the earlier policies; `.pmi` remains version 3.
- Compared fresh U/C/T inputs, library shadows and all three bundles using
  the shared upstream-compatible benchmark entry point. The final protocol
  isolates each benchmark/arm/repetition in a fresh Node process: **99
  processes, 11 workloads, 59 sizes, 531 checked measurement points**.
- At the largest inputs: upstream `fib(28)` **3.463× C/T, 3.480× U/T**;
  local `polyInt(6400000)` **1.727× C/T, 1.691× U/T**. The gains persist
  across their measured sizes. Actual WAT workers change from boxed to `i32`
  signatures, with three static `struct.new` sites reduced to zero each.
- Negative result retained: `curry(800000)` is **10.1% slower than C**
  (8.5% slower than U). Investigate profitability before a PR; do not add
  benchmark-specific exceptions or claim the entire suite improves.
  `countEffect` is byte-identical in C/T; its apparent 5% slowdown is not a
  generated-code regression. No 10× or general speedup is demonstrated.
- Final report: `bench/results/tast-recursive-int-20260921/comparison.json`,
  with its manifest and build artifacts. These are ignored generated results,
  not replacements for the tracked upstream baseline. Earlier wider-pass and
  whole-arm-process runs remain available, but are not pooled with this run.
- Validation: compiler **189/189**, CLI **30/30**, E2E **156/156** after
  rebuilding 53 fixtures, typed-worker/interop **435 assertions in 15 builds**,
  typed arrays **5 modes**, benchmark protocol **8/8**. Formatting, JS syntax
  and diff checks passed. Pinned Nix/full CI and final PR cleanup remain open.

Next investigation identified then (completed above): explain the retained curry regression and
derive a general profitability rule from its generated code. Keep the two
positive cases as controls. Stage-specific ablation, more repetitions and
another engine/machine remain useful before publishing a broad claim.

## Progress: first correctness batch (2026-09-21)

- Verified the official remote, `https://github.com/purs-wasm/purescript-backend-wasm.git`:
  `HEAD` and `refs/heads/main` both resolve to
  `9c978a2cd48aa862bb3515be5c753f603b3e0c4e` at this check.
- Restored ordinary scalar call-site inference: initially boxed parameters are
  unknown, not mandatory boxed ABI constraints. Added Int, Number, mixed-call,
  unknown-value, pinned-ABI, hint-only, and recursive-signature tests.
- Removed the duplicate direct-local lowering shortcut and its environment
  table. Restored upstream closure lowering; optimised direct calls still use
  the existing MIR `LambdaLift` pass. Added returned/partial/stored/captured/
  shadowed recursive-value guards and a local-name/intrinsic regression test.
- Fixed three further reproduced failures: unannotated roots were forced boxed,
  root TAST annotations overrode intermodule boxed ABI constraints, and short
  source signatures could truncate the actual runtime parameter list.
- Bumped `.pmi` to version 3 and the shared backend cache tag to 2. Tested old
  format rejection and typed-summary round trips. Removed branch-introduced
  duplicate intrinsic cases and unused/duplicate imports in the touched paths.
- Reworded the exploratory benchmark documentation: existing annotation-ablation
  ratios are not an upstream comparison and must be remeasured after the fixes.

Validation completed with official **PureScript 0.15.16**, Spago 1.0.3 and Node
24.8.0. The official macOS ARM64 compiler was downloaded to a temporary directory
and checked against its release checksum; no global tool was replaced. Nix is
not installed here, so this is **not** a complete pinned-Nix/CI validation.

- Compiler unit tests: **182/182 passed** (initially 160/162; new failing tests
  were observed before the corresponding fixes).
- Shared CLI unit tests: **30/30 passed**.
- Existing E2E prebuild rebuilt the tools and 53 Wasm fixtures; E2E tests:
  **156/156 passed**, including three new escaping-recursive-closure checks.
  The existing installed ulib was reused by the upstream prebuild script.
- Additional isolated runtime probes of `E2E.Closures`: **28 checks per mode**
  for default, default `--no-opt`, `--legacy`, `--legacy --no-opt`, and
  `--legacy --per-module-codegen` (140 checks total). Counter probes used bases
  0/7/19 and iteration counts 0/1/20, asserting independent expected results.
- A subsequent unforced default rebuild produced identical Wasm bytes and the
  same result; this establishes reproducibility for that fixture, not a cache
  hit-rate claim or complete dependency-invalidation coverage.
- Formatting checks and `git diff --check` passed. Formatting used purs-tidy
  0.11.1; the Nix pin remains 0.10.0 and still needs the CI check.

Reproduction uses the existing commands with the above toolchain on PATH:
`spago test -p compiler --offline --monochrome`,
`spago test -p cli-lib --offline --monochrome`,
`npm --prefix compiler run build:runtime`,
`node compiler/test/e2eCliPrebuild.mjs`, then
`spago test -p compiler -m Test.E2E.Cli --offline --monochrome`.

At the end of that first batch, still open: the remainder of the CI matrix/bin tests, typed-array soundness and
real-TAST input coverage, full cache/dependency auditing, benchmark integrity and
the U/C/T comparison, and final PR-scope cleanup. **No new optimisation block or
performance claim is approved by these correctness results alone.**

## Progress: array safety and unified measurement (2026-09-21)

- Reproduced a real miscompilation with the fork's emitted TAST: an ordinary
  `Array Int` literal passed to `Wasm.Array.unsafeIndex` returned 42 with stock
  CoreFn but trapped with the typed input. Removed the automatic native-array
  casts, primitive rewrites and layout forcing based only on source element
  type. Explicit native-array intrinsics remain supported. Automatic array
  specialisation is deferred until a coherent producer/consumer layout proof.
- Added real fork fixtures (compiler commit
  `319e138cbcbee59b3837f6cba7ca03a680395e67`), their sources, two translation
  regressions, and a CLI runtime guard in the existing `test:bin` chain. It
  returns 42 in all five modes: default, no-opt, legacy, legacy/no-opt and
  legacy/per-module. The backend cache tag is now **3**, superseding batch 1's 2.
- Kept `bench/run.mjs` and snapshot/graph conventions. Extracted shared workload
  and measurement helpers; all three bundles are required and rebuilt by the
  snapshot command. Independent expected values cover all 59 input points and
  agree with the existing historical checksums; mismatches now fail.
- Added `run.mjs --compare` and a fresh-input U/C/T builder, with seven Node
  protocol tests in the existing Benchmark CI workflow. No new CI job or fork
  dependency for ordinary builds. Baseline data and published graph scripts
  are untouched. Input ablation is explicit and tested; a future pass still
  needs its own activation/ablation diagnostics.

Executed the full **11-case / 59-point** U/C/T suite: 3 rotated repetitions,
9 independent Node processes, 7 timing batches per point; all **531 measured
points** passed their result checks. Upstream was a clean detached checkout of
`9c978a2cd48aa862bb3515be5c753f603b3e0c4e`. Both backends used stock purs
0.15.16; program inputs and isolated ulib shadows used stock purs for U and
the above fork for C/T. Runtime: Apple M4 Pro, macOS kernel 25.1.0, Node 24.8.0,
V8 13.6.233.10-node.27, Binaryen 123.0.0, Spago 1.0.3.

Local raw report and complete input/build artefacts are retained at
`/private/tmp/wasm-tast-audit.Er3nLg/comparison/` (`comparison.json`,
`manifest.json`). This is temporary local storage, not a committed benchmark
baseline; regenerate using `bench/README.md` for a public submission. The
manifest records the measured dirty-source identity; subsequent edits to
documentation, test formatting and builder preflight checks are not part of
that recorded identity.

**Negative result: all three C/T bundle pairs are byte-identical**, despite
974 typed annotations in `Bench.Main`. Sizes U → C/T: main 26703 → 24321 bytes,
Effect 4758 → 4583, curry 7467 → 6789. These size changes versus U are not a
metadata benefit. At the largest inputs, U/T ranged 0.948–1.060× and C/T ranged
0.945–1.092×. C/T timing variation with identical code cannot establish a TAST
speedup; three repetitions also do not prove performance equivalence. No
3×/10× claim follows from this experiment.

WAT inspection followed `polyInt` into its recursive worker (U `$198`, C/T
`$168` in these artefacts). All three use boxed arguments and `struct.new`
instructions on the recursive edge. The fork input already annotates the
local `loop` as `Int -> Int -> Int`. This is evidence of remaining codegen
cost and a focused propagation/consumption investigation, not a runtime
allocation count or proof that a new monomorphiser is needed.

Validation rerun: compiler **184/184**, shared CLI **30/30**, E2E **156/156**
after rebuilding all 53 fixtures; protocol **7/7**; real-TAST array runtime
guard **5/5**. Formatting and diff checks passed. The E2E prebuild still uses
the existing installed ulib; the U/C/T experiment rebuilt its own shadows.
All **13 `test:bin` scripts** also passed, including the new TAST fixture. The
literal npm command first failed because npm prepended the parent htdocs
`node_modules/.bin/spago` (legacy Dhall-based Spago). The same scripts then ran
directly, sequentially, with Spago 1.0.3 and stock purs 0.15.16 on PATH. No
upstream script or global installation was changed to hide this discrepancy.
Pinned Nix validation and the remaining PR gates are still open.

**Next experiment identified then (completed in the latest batch):** trace the already
concrete loop type through MIR optimisation/lifting, `.pmi`, the default worker
pipeline and representation inference. Determine the exact point at which it
is lost or deliberately unused. Seek a module-local typed worker with a boxed
public wrapper; do not weaken intermodule ABI pins. Compare the same change
with normal inference enabled in C and T. Only add monomorphisation if this
probe shows a genuine instantiation problem.

## Goal and non-goals

Make a reviewable, upstream-compatible contribution that demonstrates a
**measured, localised benefit of TAST information**. A local 10× speedup is an
experimental target, not an acceptance criterion or a promised outcome.

The original plan put all correctness/measurement gates before performance
work. The latest user request prioritised the bounded experiment above after
the reproduced correctness fixes and controlled measurement infrastructure.
Unfinished gates still block a merge-readiness claim. Do not weaken the
existing optimiser to manufacture headroom.
Preserve ordinary CoreFn support, the upstream build/benchmark workflow, and
public ABI behaviour. Do not make the PureScript fork or PBO mandatory for
users who do not enable TAST support.

## Initial review findings (before the corrections above)

These observations concern local HEAD `903efe22613a3e178b299d7a413bd42ea6cded87`
plus the existing uncommitted changes, compared with local `main`
`9c978a2cd48aa862bb3515be5c753f603b3e0c4e`. Neither remote named
`origin` nor `fork` currently identifies the maintainers' upstream: both
point to the user's fork.

- The last unit run passed 160/162 tests, with failures for recursive local
  functions wrapped in `mkFnN` or a let (`UnknownVariable "go"/"descend"`).
  This used the ambient toolchain, not yet the repository's pinned environment.
- An in-memory IR probe of `id(x) = x; main() = id(42)` remained boxed with the
  current representation solver. Replacing only its initial seeds with the
  local-main `Top` seeds made it infer `i32`. This was a diagnostic using the
  built JavaScript, not an independent upstream build or a timing measurement.
  In `Lower/Unbox.purs`, `paramTy` and `initialSig` treat initially `Boxed`
  parameters as `Bx`, which absorbs the call-site evidence. Unknown initial
  representation and required boxed ABI must be distinguished.
- Therefore the earlier approximately 1.5× annotation-on/off result is
  provisional: the control may be disadvantaged. It does not yet establish
  an improvement over upstream's normal optimised output.
- `CoreFn/FromJSON.purs` reduces rich types to a small representation-oriented
  subset. It discards quantifier/constraint structure; `MiddleEnd/Transl.purs`
  erases expression `TypeApp`. The current module reader does not retain
  `dataDecls` or `classDecls`. Full call-site monomorphisation is not wired.
- MIR serialisation has changed, but the `.pmi` format version is still 2.
  Cache compatibility/invalidation needs an explicit audit.
- `bench/run.mjs` records results but does not assert equality against the
  baseline. `bench/snapshot.sh` builds only `Bench.Main`; optional benchmark
  bundles can be missing or stale. A successful timing run is not a correctness
  check or evidence that the whole suite was rebuilt.
- `bench/tast-proof.mjs` removes annotation types, not all TAST information.
  It reuses existing input and CLI bundles. Its current output lacks the full
  provenance, raw samples, and independent repetitions required below.

The array representation and local-lifting hazards listed below are additional
code-review risks to test, not claims of already reproduced runtime failures.

## 0. Correctness and upstream-readiness gate

### Establish a trustworthy base

- [x] Identify the real upstream and record an exact reference commit; inspect
      compatibility with its current structure. Do not call local `main`
      "latest upstream" without checking.
- [ ] Inventory the six branch commits and dirty changes. Separate TAST work,
      unrelated fixes, formatting, experimental arrays/Int64 changes, lockfile
      churn, generated files, and scratch artefacts. Preserve existing work;
      do not reset, rebase, or rewrite history as an incidental cleanup.
- [ ] Use the repository's pinned Nix/pnpm environment and CI commands. Record
      tool versions; do not change upstream scripts to accommodate an
      incompatible ambient Spago.
- [ ] Reproduce failures in that environment and compare the relevant tests
      against the chosen upstream base. Fix all branch-introduced failures.
      Any independently confirmed upstream failure must be disclosed.
- [ ] Review introduced warnings separately from existing upstream warnings;
      pass formatting, static checks, compiler/runtime/tooling tests.

### Restore the existing optimiser before measuring TAST

- [x] Turn the `id(42)` diagnostic into a small permanent unit regression.
      Preserve ordinary call-site inference when TAST is absent.
- [ ] Separate unknown representations, proven scalar representations, and
      mandatory ABI constraints in the solver. Check joins, recursion,
      heterogeneous call sites, closure arguments, and pinned signatures.
      Preserve monotonicity and termination.
- [x] Fix the two local-recursion failures. First determine whether the new
      lowering shortcut duplicates work already handled by `LambdaLift`;
      prefer the existing path or conservative fallback where possible.
- [ ] Test self-reference as a value: returned, partially applied, stored in
      a record/array, or captured by another lambda. Also cover shadowing,
      nested/mutual recursion, zero and multiple captures, and under/over-
      application. Audit remapping of captured slots into lifted functions.
      Checking only the final continuation is not sufficient.
- [ ] Verify optimisation-disabled, whole-program, and default per-module
      compilation, including separately compiled callers and public wrappers.

### Make artefacts and caches dependable

- [x] Version changed serialised layouts and test rejection of old `.pmi` files;
      bump the shared backend cache tag to invalidate old store artefacts.
- [ ] Audit cache keys for source TAST, dependency summaries,
      compiler identity, representation policy, and relevant flags.
- [ ] Compare fresh, warm-cache, and forced rebuild outputs/results. Test that
      modifying a specialised dependency invalidates its consumers.
- [x] Keep upstream snapshot history intact. Preserve local measurements as
      separately named experiments instead of replacing the historical
      baseline; review the existing baseline diff before moving anything.
- [ ] Remove or isolate proven scratch/generated artefacts and unrelated
      package-manager changes, without discarding user work.
- [ ] Document the supported input contract and representation/ABI invariants
      in the existing developer-guide/ADR structure.

Exit: the standard path remains correct with and without TAST; reproducible
checks are green, with any pre-existing failures explicitly accounted for.
Only then proceed to a new optimisation.

## 1. Fit TAST into the existing Wasm pipeline

Wasm already has `Specialize`, dictionary elimination, lambda lifting,
unboxing, and per-module dependency summaries. It also obtains useful type
information from externs. Do not attribute their existing wins to new TAST work.

### Preserve only the additional facts we actually need

- [ ] Specify the minimum contract for the first scalar specialisation:
      scoped type variables, concrete instantiations, function types, and
      dictionary/value arguments must remain distinguishable.
- [ ] Resolve supported `typeTable` entries safely; test bad indices and
      cycles and avoid repeatedly expanding large shared type structures.
      Missing metadata means unknown; unsupported valid types use a generic
      fallback. Malformed supported metadata must produce useful diagnostics.
- [ ] Preserve call-site `TypeApp` evidence in MIR before erasing type
      application syntax. Test applications with nested/interleaved type
      applications, implicit instantiation, and explicit visible application.
- [ ] Do not equate a source function type with a lowered runtime signature:
      dictionaries, captures, currying, and effect thunks affect arity.
      Representation selection must not truncate or misalign parameters.
- [ ] Define which passes substitute, preserve, recompute, or invalidate each
      fact. A cloned or transformed expression must not keep stale types.
- [x] Add small checked-in fixtures from the real `../purescript` exporter,
      with provenance, alongside stock-CoreFn fixtures. Test parsing,
      propagation, and generated runtime behaviour. Fixture generation must
      be documented without hardcoded personal paths.
- [ ] Read `dataDecls`/`classDecls` when a concrete later optimisation needs
      them, rather than adding an unused wholesale second AST now.

### Reuse ideas, not another backend's architecture

Extend Wasm's own passes. Its specialisations are homed in the **consumer
module**, preserving dependency-directed compilation and caching. An imported
whole-program monomorphiser must not make a dependency's output depend on all
its consumers.

Useful reference implementations, not build dependencies:

- `../gopurs/gopurs/src/Gopurs/Monomorphization.purs`: bounded instantiation
  discovery, type substitution, transitive worklists, and fallback rules.
  Its whole-program collection is not a drop-in Wasm pass.
- `../purust/purust/src/Purust/RecordScalarization.purs`: narrow scalar
  workers for closed records, with conservative rejection of unsupported uses.
- Purust's neighbouring `FunctionFusion.purs` and `ThunkFusion.purs`:
  narrowly guarded transformations of counted producers/strict thunks, not
  an existing general `map`/`fold` stream-fusion engine.

## 2. First optimisation: one narrow, attributable scalar win

Before implementation, use a short execution/WAT/profile probe to establish
what upstream still boxes or dispatches indirectly. If the existing optimiser
already removes the cost, choose another representative case rather than
disabling that optimisation.

- [x] First trace the concrete `polyInt.loop` annotation to the default
      pipeline's boxed worker (see measured result above). Prefer the smallest
      sound propagation/worker-wrapper change if no cloning is required.
- [x] Implement the narrower concrete-signature worker/wrapper first; document
      the real incremental gains and regressions in `TAST.md`. General
      polymorphic instantiation below is deferred, not implied by this pass.
- [ ] Start with a pure, known-body, module-local polymorphic function called
      at a concrete `Int` instantiation. No new array layout or public ABI.
- [ ] Add type-directed specialisation to the existing machinery, keyed by
      callee and concrete type tuple, plus any proven static value arguments.
      Handle recursion deterministically; bound clone count and code size.
- [ ] Substitute types through the cloned body, preserve scope/hygiene, and
      keep the generic original reachable for unknown/higher-rank callers.
      Unsupported instantiations must fall back, not miscompile.
- [ ] Eliminate a dictionary argument only when its actual implementation is
      proven. `classDecls` gives shape, not the chosen dictionary value;
      `Semiring Int` alone does not justify replacing arbitrary code with
      integer addition. Similarly, a function type does not identify a closure.
- [x] Verify `i32` worker arguments/results and direct calls where intended,
      including recursive calls; avoid immediate reboxing in the hot path.
- [ ] Cover multiple instantiations in the same program, a dynamic dictionary
      negative case, fallback/escaping uses, and Int32 overflow semantics.
      Add `Number` only in a separate step with NaN, infinities, and signed zero.
- [ ] Prove the pass fired using diagnostics/IR assertions and WAT, then run
      the three-arm benchmark below. Include a non-benchmark-specific second
      example before claiming general utility.

Exit: a small correct patch with an explained, repeatable incremental benefit,
or a documented negative result that redirects the next experiment.

## 3. Later candidates, selected by measured remaining costs

Do not implement this entire ladder in one PR. Decide the next block after
profiling the corrected, optimised baseline.

### Primitive arrays

- [ ] Reuse the existing explicit `Wasm.I32Array`/`Wasm.F64Array` machinery
      where suitable; first limit automatic layout choice to a proven internal
      producer/consumer region.
- [ ] Make layout a coherent IR decision across allocation, reads/writes,
      control-flow joins, aliases, closures, and calls. Static `Array Int`
      alone does not prove the array uses the Wasm `i32` heap layout.
- [x] Audit current `unsafeI32Cast` insertion. A Wasm `ref.cast` checks a heap
      type; it does not convert an array of boxed values into an `i32` array.
      Unsupported boundaries need explicit conversion or generic fallback.
- [ ] Test empty/small arrays, generic producers/consumers, FFI and JS
      marshalling, exported APIs, alias preservation, bounds behaviour, and
      mutable/ST interactions. Include all conversion costs in end-to-end
      measurements.
- [ ] Separate Int, Number, and Int64 changes. Primitive arrays remain GC heap
      objects; any claim concerns removed element boxing/allocation, not
      elimination of GC itself.

### Closed-record/ADT scalarisation

- [ ] Investigate closed numeric accumulator records as another narrow worker/
      wrapper optimisation, potentially before automatic array conversion.
- [ ] Compare with layouts already derived from externs. Use TAST declarations
      to supply missing structural facts, not to claim an existing upstream
      field-unboxing improvement as new.
- [ ] Keep boxed public wrappers and fallback for open rows, unknown consumers,
      escaping values, and unsupported recursive/polymorphic layouts.

### Fusion and cross-module workers

- [ ] Consider `map`/`filter` + `fold` only after showing an intermediate
      allocation survives existing passes. Preserve evaluation order,
      observable effects, traps, termination, and numeric semantics.
      Do not reassociate floating-point arithmetic from algebraic laws alone.
- [ ] Separate fusion that works without TAST from additional type-driven
      specialisation, so the measured attribution remains honest.
- [ ] Extend per-module summaries only when justified; keep deterministic
      consumer-local clones, ABI-compatible wrappers, dependency invalidation,
      and separately compiled clients working.
- [ ] Never infer uniqueness, absence of aliases, or permission to mutate from
      `bindingUsage`/`variableUse`. Follow `../purescript/CORE_FN_USAGE.md`;
      invalidate facts after transformations unless their validity is proven.

## 4. One upstream-compatible benchmark entry point

Keep `bench/run.mjs`, the existing workload suite, snapshot conventions, and
published results as the primary progression dashboard. Add an explicit
paired experiment mode/report, sharing workload definitions and measurement
helpers. Do not maintain a disconnected proof suite with a different baseline.

### Three comparison arms

| Arm | Purpose |
| --- | --- |
| U: pinned upstream, normal optimisations | Real maintainer-facing reference |
| C: proposed branch, TAST-derived optimisation disabled | Compatibility and control, without disabling ordinary optimisations |
| T: same branch/input, TAST-derived optimisation enabled | Incremental type-information benefit |

- [x] Compare C and T from identical freshly generated fork artefacts. Prefer
      an explicit flag gating consumption of type information/typed passes
      while keeping necessary syntax normalisation and existing passes.
- [x] Ensure U uses compatible input. If upstream cannot read the fork's
      `TypeApp` syntax, compile the same source with stock PureScript and
      record that frontend difference. U/T then measures the net delivered
      pipeline improvement; C/T is the controlled causal comparison.
- [ ] Verify C does not regress U. Deleting `ann.type` alone is an annotation
      ablation, not proof that the full TAST is disabled.
- [ ] Retain stage ablations for individual new passes. If a non-type-driven
      improvement helps both arms, enable it in both; do not multiply
      unrelated speedup ratios or assign the entire combined win to TAST.

### Correctness, freshness, and reproducibility

- [x] Fresh-build frontend input, backend, worker/CLI bundles, and every
      measured entry point. Use isolated output/cache directories per arm.
      Fail on missing required cases instead of silently skipping them.
- [ ] Assert results against independent expected/reference values as well as
      across arms, for every input size. Add differential/property tests and
      edge cases; timing checksums alone can let all variants share a bug.
- [ ] Fail the TAST proof if required metadata is absent or the intended
      transformation did not fire. Identical artefacts are a valid no-change
      result, not a speedup attributable to that pass.
- [x] Record source/backend/frontend revisions and dirty-tree identity,
      commands/flags, Node/V8/Binaryen/toolchain versions, machine/OS, input
      hashes, artefact hashes/sizes, and cache policy.
- [ ] Keep builds outside runtime timing. Report kernel timing and relevant
      end-to-end timing separately; do not hide conversion, marshalling,
      instantiation, or build/code-size regressions.

### Measurements and attribution

- [x] Keep legacy timing outputs compatible. Add paired measurements with
      identical warmup/calibration, alternating or randomised arm order, and
      repeated independent processes. Store raw samples, median, spread,
      and the method for any reported uncertainty.
- [x] Run multiple sizes and the full existing suite. Publish individual
      regressions as well as wins; do not select only the best time/size.
      Performance ratios are reports, not flaky CI pass/fail assertions.
- [x] Inspect the actual hot worker and its transitive callees in WAT. Static
      `struct.new`/`call_ref` counts explain code shape, not dynamic allocation
      counts. Use runtime evidence before claiming allocations per iteration.
- [ ] Add a representative generic numeric workload only if it exposes
      remaining costs; `sumSquares :: forall a. Semiring a => Array a -> a`
      is a candidate, not a guaranteed 10× opportunity.
- [x] Consult the historical baselines in `../altbak.pub/README.md` for context
      and workload inspiration. Do not compare raw times/ratios across
      different programs, backends, hardware, or protocols as equivalent data.

A publishable claim names the workload, sizes, commits, runtime, uncertainty,
and costs included. Report both U/T (net benefit) and C/T (controlled TAST
benefit), including limitations. Do not call a deliberately forced-boxed
baseline "upstream".

## 5. Reviewable delivery order

1. Correctness/compatibility repairs and benchmark integrity, independently
   testable before adding another optimisation.
2. Minimal optional TAST contract, real fixtures, propagation and cache/ABI
   invariants; documentation of scope and fallbacks.
3. One bounded scalar specialisation with semantic tests, structural evidence,
   and reproducible three-arm results.
4. Only then, independently justified array, record, fusion, or cross-module
   follow-ups, each with its own attribution and regression checks.

Before proposing a PR: reproduce the standard checks from a clean checkout,
supply exact commands and expected results, inspect the full upstream diff,
and remove incidental churn. Keep the requested local roadmap, but decide
which planning material belongs in a public PR.

Maintainer acceptance and 10× are not promised. A smaller genuine upstream
improvement with a narrow, well-tested patch is stronger evidence than a
larger ratio against a weakened control.
