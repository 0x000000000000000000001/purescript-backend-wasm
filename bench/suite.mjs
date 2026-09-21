// Shared by the historical runner and paired comparisons. Sizes and workloads
// remain the upstream suite; expected results are independent of compiler output.
export const bundles = {
  main: { entry: "Bench.Main", directory: "output-wasm" },
  countEffect: { entry: "CountEffect", directory: "output-wasm-count-effect" },
  curry: { entry: "BenchCurry", directory: "output-wasm-curry" },
};

const int32 = n => Number(BigInt.asIntN(32, n));
const squareSum = n => int32(BigInt(n) * BigInt(n + 1) * BigInt(2 * n + 1) / 6n);
const treeSum = depth => { const n = (1n << BigInt(depth)) - 1n; return int32(n * (n + 1n) / 2n); };
const mapSum = n => int32(2003000n * BigInt(n));
function fib(n) { let a = 0, b = 1; for (let i = 0; i < n; i++) [a, b] = [b, a + b]; return a; }
function curry(n) {
  let acc = 0;
  for (let k = 1; k <= n; k++) {
    const value = [() => 3 * k + 3, () => Math.imul(k, k + 1) + k + 2,
      () => k + Math.imul(k + 1, k + 2), () => k + 1][k % 4]();
    acc = (acc + value) | 0;
  }
  return acc;
}

export const benches = [
  { name: "fib", sizes: [20, 22, 24, 26, 28], desc: "tree recursion + Int arithmetic", expected: fib },
  { name: "sumLoop", sizes: [200_000, 400_000, 600_000, 800_000, 1_000_000], desc: "tail loop; +/*/> via Prelude dicts", expected: squareSum },
  { name: "qsort", sizes: [500, 1000, 1500, 2000, 3000], desc: "list quicksort: closures, Ord, alloc", expected: () => 1 },
  { name: "nqueens", sizes: [6, 7, 8, 9], desc: "backtracking; mutual recursion", expected: n => ({ 6: 4, 7: 40, 8: 92, 9: 352 })[n] },
  { name: "bintreeDfs", sizes: [12, 13, 14, 15, 16, 17], desc: "DFS over a balanced tree", expected: treeSum },
  { name: "bintreeBfs", sizes: [8, 9, 10, 11, 12], desc: "BFS (list queue) over a tree", expected: treeSum },
  { name: "mapFold", sizes: [100, 200, 300, 400, 500], desc: "map/foldl over a list; closure args", expected: mapSum },
  { name: "mapFoldArray", sizes: [100, 200, 300, 400, 500], desc: "map/foldl over a Data.Array (ulib HOFs)", expected: mapSum },
  { name: "countEffect", bundle: "countEffect", fn: "countTo", sizes: [1000, 2000, 4000, 8000, 16000, 32000, 64000], desc: "Effect monad: cyclic instance dicts → constant-stack loop", expected: n => n },
  { name: "curry", bundle: "curry", fn: "curryDispatch", sizes: [50_000, 100_000, 200_000, 400_000, 800_000], desc: "curried Int->Int->Int dispatch (closure-alloc)", expected: curry },
  { name: "polyInt", sizes: [100_000, 200_000, 400_000, 800_000, 1_600_000, 3_200_000, 6_400_000], desc: "recursive Int loop; TAST metadata experiment", expected: n => n },
];

export function checkResult(bench, size, result, historical) {
  const expected = bench.expected(size);
  if (!Number.isInteger(expected) || result !== expected) {
    throw new Error(`${bench.name}(${size}): expected ${expected}, got ${result}`);
  }
  if (historical && historical.result !== result) {
    throw new Error(`${bench.name}(${size}): historical checksum ${historical.result} differs from ${result}`);
  }
}
