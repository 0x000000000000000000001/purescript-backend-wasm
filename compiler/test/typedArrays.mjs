// Real TAST regression: an Array Int literal still uses the generic heap layout.
// Run after building purs-wasm/purwc, as for the other test:bin scripts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "purs-wasm-typed-arrays-"));
try {
  for (const [module, fixture] of [["ArrayProbe", "TastArray"], ["Wasm.Array", "TastWasmArray"]]) {
    const dest = join(dir, "input", module);
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(repo, "compiler/test/fixtures", `${fixture}.corefn.json`), join(dest, "corefn.json"));
  }
  const modes = [[], ["--no-opt"], ["--legacy"], ["--legacy", "--no-opt"], ["--legacy", "--per-module-codegen"]];
  for (const [index, flags] of modes.entries()) {
    const out = join(dir, `out-${index}`);
    execFileSync(process.execPath, [join(repo, "purs-wasm/index.js"), "build", "--force",
      "-I", join(dir, "input"), "-O", out, "-e", "ArrayProbe", ...flags],
    { cwd: repo, env: { ...process.env, PURS_WASM_STORE: join(dir, "store") }, stdio: "pipe" });
    const { instance } = await WebAssembly.instantiate(readFileSync(join(out, "index.wasm")), {});
    instance.exports.caf_init?.();
    assert.equal(instance.exports.main(0), 42, flags.join(" ") || "default");
  }
  console.log("typedArrays: all five build modes return 42");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
