// Build the U/C/T inputs and bundles, then use the shared benchmark runner.
// Requires a clean, separate upstream checkout; never changes branches or baselines.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { benches, bundles } from "./suite.mjs";
import { annotationCount, eraseTast } from "./tast-input.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: {
  upstream: { type: "string" }, "stock-purs": { type: "string" },
  "tast-purs": { type: "string" }, output: { type: "string" },
  benchmarks: { type: "string" },
} });
for (const key of ["upstream", "stock-purs", "tast-purs", "output"]) {
  if (!values[key]) throw new Error(`Missing --${key}; see bench/README.md`);
}
const upstream = resolve(values.upstream), output = resolve(values.output);
const stock = resolve(values["stock-purs"]), typed = resolve(values["tast-purs"]);
const selection = values.benchmarks?.split(",");
if (selection && (new Set(selection).size !== selection.length ||
    selection.some(name => !benches.some(b => b.name === name)))) throw new Error("Invalid benchmark selection");
if (upstream === resolve(repo)) throw new Error("Upstream must be a separate checkout");
if (existsSync(output)) throw new Error("Output must be a new directory; previous results are preserved");
const commands = [];
function run(command, args, cwd = repo, env = process.env, capture = false) {
  commands.push({ command, args, cwd });
  return execFileSync(command, args, { cwd, env, encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", maxBuffer: 32 * 1024 * 1024 });
}
const git = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
if (git(upstream, "status", "--porcelain")) throw new Error("Upstream checkout must be clean");
const digest = data => createHash("sha256").update(data).digest("hex");
function treeHash(dir) {
  const hash = createHash("sha256");
  const visit = (path, prefix = "") => {
    for (const name of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = join(prefix, name.name), file = join(path, name.name);
      if (name.isDirectory()) visit(file, rel);
      else { hash.update(rel + "\0"); hash.update(readFileSync(file)); hash.update("\0"); }
    }
  };
  visit(dir);
  return hash.digest("hex");
}
function sourceIdentity(dir) {
  const hash = createHash("sha256");
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {cwd: dir, encoding: "utf8"}).split("\0").filter(Boolean).sort();
  for (const file of files) {
    hash.update(file + "\0");
    hash.update(existsSync(join(dir, file)) ? readFileSync(join(dir, file)) : "<deleted>");
    hash.update("\0");
  }
  return { revision: git(dir, "rev-parse", "HEAD"), dirty: !!git(dir, "status", "--porcelain"), sourceHash: hash.digest("hex") };
}
const versions = Object.fromEntries([["stock", stock], ["typed", typed]].map(([name, path]) =>
  [name, { version: run(path, ["--version"], repo, process.env, true).trim(), sha256: digest(readFileSync(path)) }]));
const identities = { upstream: sourceIdentity(upstream), branch: sourceIdentity(repo) };
const ulibSources = git(repo, "ls-files", "ulib").split("\n");
if (git(repo, "ls-files", "ulib") !== git(upstream, "ls-files", "ulib") ||
    ulibSources.some(file => !existsSync(join(upstream, file)) ||
    !readFileSync(join(repo, file)).equals(readFileSync(join(upstream, file))))) {
  throw new Error("Upstream and branch ulib sources differ; this protocol requires a shared library source");
}
mkdirSync(output, { recursive: true });
const env = { ...process.env, PATH: dirname(stock) + ":" + process.env.PATH };

// Both backends are rebuilt with the same stock compiler; only their program inputs differ.
for (const dir of [upstream, repo]) {
  for (const pkg of ["purs-wasm", "purwc", "ulib-tooling"]) run("spago", ["build", "-p", pkg, "--offline"], dir, env);
  run(join(dir, "binaryen/node_modules/binaryen/bin/wasm-as"),
    ["--all-features", join(dir, "runtime/runtime.wat"), "-o", join(dir, "runtime/runtime.wasm")], dir, env);
}
const globs = JSON.parse(run("spago", ["sources", "-p", "bench", "--json", "--offline"], repo, env, true));
for (const [arm, purs] of [["upstream", stock], ["typed", typed]]) {
  run(purs, ["compile", ...globs, "--codegen", "corefn", "--output", join(output, arm, "input")], repo, env);
  // ulib sources are shared in this experiment (checked above).
  run(process.execPath, [join(repo, "ulib-tooling/index.js"), "install", "--force",
    "--purs", purs, "--lib-path", join(output, arm, "lib")], repo, env);
}
for (const kind of ["input", "lib"]) {
  const src = join(output, "typed", kind), dest = join(output, "control", kind);
  cpSync(src, dest, { recursive: true, errorOnExist: true });
  for (const mod of readdirSync(dest)) {
    const file = join(dest, mod, "corefn.json");
    if (existsSync(file)) writeFileSync(file, JSON.stringify(eraseTast(JSON.parse(readFileSync(file, "utf8")))) + "\n");
  }
}
const root = JSON.parse(readFileSync(join(output, "typed/input/Bench.Main/corefn.json"), "utf8"));
if (annotationCount(root) === 0) throw new Error("The TAST compiler emitted no annotation types in Bench.Main");

const variants = {};
for (const arm of ["upstream", "control", "typed"]) {
  const dir = arm === "upstream" ? upstream : repo;
  const input = join(output, arm, "input"), lib = join(output, arm, "lib");
  const armEnv = { ...env, PURS_WASM_LIB: lib, PURS_WASM_STORE: join(output, arm, "store") };
  const paths = {};
  for (const [key, bundle] of Object.entries(bundles)) {
    const out = join(output, arm, bundle.directory);
    run(process.execPath, [join(dir, "purs-wasm/index.js"), "build", "-I", input, "-O", out,
      "-e", bundle.entry, "--force"], dir, armEnv);
    paths[key] = join(out, "index.wasm");
  }
  variants[arm] = {
    ...identities[arm === "upstream" ? "upstream" : "branch"],
    frontend: versions[arm === "upstream" ? "stock" : "typed"],
    inputHash: treeHash(input), libHash: treeHash(lib), bundles: paths,
  };
}
const manifest = {
  schemaVersion: 1, variants,
  benchmarks: selection,
  provenance: {
    commands, toolchain: { node: process.version, spago: run("spago", ["--version"], repo, env, true).trim() },
    binaryen: JSON.parse(readFileSync(join(repo, "binaryen/node_modules/binaryen/package.json"))).version,
    sourceGlobs: globs, benchSourceHash: treeHash(join(repo, "bench/src")),
    lockHash: digest(readFileSync(join(repo, "spago.lock"))), annotationCount: annotationCount(root),
    control: "Same fork outputs as typed, with annotation types, TypeApp type arguments, declaration/foreign type tables and usage facts erased; TypeApp syntax preserved. Ordinary optimisations unchanged.",
    upstream: "Same benchmark/library sources, compiled by stock purs; frontend differs from C/T.",
  },
};
const manifestPath = join(output, "manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
run(process.execPath, [join(repo, "bench/run.mjs"), "--compare", manifestPath, output], repo, env);
