// Real fork fixtures: typed workers must preserve public/closure/module ABIs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "purs-wasm-typed-workers-"));
const modes = [[], ["--no-opt"], ["--legacy"], ["--legacy", "--no-opt"], ["--legacy", "--per-module-codegen"]];
let checks = 0;
const check = (actual, expected) => { assert.equal(actual, expected); checks++; };

async function build(entry, index, flags, stockClient = false) {
  const input = join(dir, `${entry}-${index}-${stockClient}`, "input"), out = join(input, "..", "out");
  for (const module of ["TastIntLib", "TastIntClient"]) {
    const dest = join(input, module);
    mkdirSync(dest, { recursive: true });
    const file = module + (stockClient && module === "TastIntClient" ? "Stock" : "");
    copyFileSync(join(repo, "compiler/test/fixtures", `${file}.corefn.json`), join(dest, "corefn.json"));
  }
  execFileSync(process.execPath, [join(repo, "purs-wasm/index.js"), "build", "--force",
    "-I", input, "-O", out, "-e", entry, ...flags],
  { cwd: repo, env: { ...process.env, PURS_WASM_STORE: join(out, "store") }, stdio: "pipe" });
  const { instance } = await WebAssembly.instantiate(readFileSync(join(out, "index.wasm")), {});
  instance.exports.caf_init?.();
  return instance.exports;
}

try {
  for (const [index, flags] of modes.entries()) {
    const lib = await build("TastIntLib", index, flags);
    for (const n of [0, 1, 2, 7, 30]) {
      check(lib.localLoop(n), n);
      check(lib.evenCount(n), n);
      check(lib.oddCount(n), n);
      for (const seed of [0, -19, 2147483647, -2147483648]) check(lib.loop(n, seed), (seed + n) | 0);
    }
    for (const n of [0, 1, -1, 65537, 2147483647, -2147483648]) {
      check(lib.square(n), Math.imul(n, n));
      check(lib.partial(n), (n + 6) | 0);
      check(lib.stored(n), (n + 8) | 0);
      check(lib.joinValue(n), n === 0 ? 42 : (n + 1) | 0);
      check(lib.fallback(n), n);
      check(lib.add(n, 1), (n + 1) | 0);
    }
    // Both typed and stock callers must link against the same boxed public ABI.
    for (const stock of [false, true]) {
      const client = await build("TastIntClient", index, flags, stock);
      for (const n of [0, 1, 7, 30]) check(client.crossModule(n), n + 7);
      for (const n of [-17, 0, 8, 2147483647]) check(client.crossPartial(n), (n + 10) | 0);
    }
  }
  console.log(`typedWorkers: ${checks} checks pass in five modes, including stock clients`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
