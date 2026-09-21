-- | The closures E2E fixture (built standalone by `purs-wasm build -e E2E.Closures`,
-- | asserted by `Test.E2E.Cli.Closures`).
-- |
-- | Capturing lambdas, higher-order application, and local recursive functions
-- | used as values (returned, stored in a record, or partially applied).
-- |
-- |   * `addThruClosure` builds a capturing lambda and applies it immediately —
-- |     closure creation + a single `call_ref`.
-- |   * `applyTwice` is higher-order: it applies an unknown function value (its
-- |     parameter) twice, each application exact.
-- |   * `twiceAdd` passes a capturing lambda to `applyTwice`.
-- |
-- | `addThruClosure a b == a + b`; `twiceAdd k x == k + (k + x)`. The
-- | host-callable entry points are `Int`-typed; `applyTwice` takes a function so
-- | it is exercised only through `twiceAdd`. Uses a module-local foreign `intAdd`
-- | (mapped to an i32 intrinsic), so no dictionaries are pulled in.
module E2E.Closures where

foreign import intAdd :: Int -> Int -> Int
foreign import intSub :: Int -> Int -> Int

addThruClosure :: Int -> Int -> Int
addThruClosure a b = (\y -> intAdd a y) b

applyTwice :: (Int -> Int) -> Int -> Int
applyTwice f x = f (f x)

twiceAdd :: Int -> Int -> Int
twiceAdd k x = applyTwice (\y -> intAdd k y) x

-- `f x y` applies an unknown function value to *two* arguments — a multi-argument
-- application, lowered to a chain of single-argument `call_ref`s.
applyBoth :: (Int -> Int -> Int) -> Int -> Int -> Int
applyBoth f x y = f x y

-- `sum3 a b c == a + b + c`, via a nested capturing lambda passed to applyBoth.
sum3 :: Int -> Int -> Int -> Int
sum3 a b c = applyBoth (\x y -> intAdd (intAdd a x) y) b c

-- The recursive function escapes as a value and captures `base`. Lowering must
-- retain a callable closure when the optimiser has not lifted it to a worker.
makeCounter :: Int -> Int -> Int -> Int
makeCounter base = go
  where
  go 0 acc = intAdd base acc
  go n acc = go (intSub n 1) (intAdd acc 1)

storedCounter :: Int -> Int -> Int
storedCounter base n =
  let
    holder = { run: makeCounter base }
  in
    applyBoth holder.run n 0

partialCounter :: Int -> Int -> Int
partialCounter base n =
  let
    finish = makeCounter base n
  in
    finish 0

capturedCounter :: Int -> Int -> Int
capturedCounter base n =
  let
    go = makeCounter base
  in
    applyTwice (\x -> go n x) 0
