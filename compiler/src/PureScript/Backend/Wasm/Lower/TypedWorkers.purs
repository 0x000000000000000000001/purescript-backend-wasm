-- | Keep separately compiled functions' boxed ABI, but move a concretely typed
-- | self-recursive Int body into a private i32 worker. At most one worker per function;
-- | no dependency bodies, dictionary assumptions, array layouts or MIR changes.
module PureScript.Backend.Wasm.Lower.TypedWorkers (splitIntWorkers) where

import Prelude

import Data.Array as Array
import Data.Foldable (all, any, foldl)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), maybe)
import Data.Set as Set
import Data.Tuple (Tuple(..))
import PureScript.Backend.Wasm.Intrinsics (Intrinsic(..))
import PureScript.Backend.Wasm.Lower.IR (AnfExpr(..), Atom(..), Branch(..), FuncName(..), IRFunc, LitBranch(..), Rep(..), Rhs(..), Slot(..), VarRef(..))
import PureScript.Backend.Wasm.Lower.Unbox (TyRep(..))
import PureScript.CoreFn (ExprType(..))

type Sig = { params :: Array TyRep, result :: TyRep }
type Worker = { name :: FuncName, arity :: Int }

splitIntWorkers
  :: Map FuncName ExprType
  -> Map FuncName Sig
  -> Array IRFunc
  -> { funcs :: Array IRFunc, pins :: Map FuncName Sig }
splitIntWorkers types pins funcs =
  if Map.isEmpty workers then { funcs, pins }
  else
    { funcs: Array.concatMap split funcs
    , pins: Map.union pins workerPins
    }
  where
  allocated = foldl allocate { used: Set.fromFoldable (map _.name funcs), workers: Map.empty } funcs
  workers = allocated.workers
  workerPins = Map.fromFoldable
    ( map (\(Tuple _ w) -> Tuple w.name { params: Array.replicate w.arity Ti32, result: Ti32 })
        (Map.toUnfoldable workers :: Array (Tuple FuncName Worker))
    )

  allocate acc fn = case Map.lookup fn.name types, Map.lookup fn.name pins of
    Just (TypeFunc args TypeInt), Just sig
      | not (Array.null args)
      , Array.length args == Array.length fn.params
      , all isInt args
      , all (_ == Bx) sig.params
      , sig.result == Bx
      , anyRhs (callsSelf fn.name) fn.body
      , not (anyRhs callsClosure fn.body) ->
          let
            name = fresh acc.used fn.name 0
          in
            { used: Set.insert name acc.used
            , workers: Map.insert fn.name { name, arity: Array.length args } acc.workers
            }
    _, _ -> acc

  isInt TypeInt = true
  isInt _ = false

  fresh used (FuncName base) n =
    let
      name = FuncName (base <> "$tast" <> show n)
    in
      if Set.member name used then fresh used (FuncName base) (n + 1) else name

  split fn = case Map.lookup fn.name workers of
    Nothing -> [ fn { body = redirect fn.body } ]
    Just w ->
      let
        args = Array.mapWithIndex (\i _ -> AVar (Local (Slot i))) fn.params
        result = Slot w.arity
        wrapper = fn
          { body = Let result Boxed (RCallKnown w.name args) (Return (AVar (Local result)))
          , localCount = w.arity + 1
          , forcedReps = Map.empty
          }
        worker = fn
          { name = w.name
          , params = Array.replicate w.arity I32
          , result = I32
          , export = Nothing
          , body = redirect fn.body
          }
      in
        [ wrapper, worker ]

  -- Only direct, saturated local calls change target. Closure layouts, captured
  -- values and unknown applications stay under the existing calling convention.
  redirect = case _ of
    Return a -> Return a
    Let slot rep rhs k -> Let slot rep (redirectRhs rhs) (redirect k)
    Switch a branches dflt -> Switch a (map (\(Branch tag b) -> Branch tag (redirect b)) branches) (map redirect dflt)
    LitSwitch a branches dflt -> LitSwitch a (map (\(LitBranch pat b) -> LitBranch pat (redirect b)) branches) (map redirect dflt)
    LetRec binds k -> LetRec binds (redirect k)
    LetJoin slot rep producer k -> LetJoin slot rep (redirect producer) (redirect k)

  redirectRhs rhs = case rhs of
    RCallKnown name args -> case Map.lookup name workers of
      Just w | Array.length args == w.arity -> RCallKnown w.name args
      _ -> rhs
    _ -> rhs

-- | Limit this first pass to repeated recursive edges. Splitting leaf functions
-- | adds an ABI adapter without establishing a hot-path benefit (notably when
-- | used as curried closures). Mutual recursion can be handled separately once
-- | an SCC-level cost model and evidence justify it. An opaque closure call can
-- | require repeated reboxing of scalar arguments that the boxed loop reused.
-- | Until those costs are modelled, keep such bodies on the existing path. This
-- | is a conservative profitability guard, not a semantic restriction on Int.
callsSelf :: FuncName -> Rhs -> Boolean
callsSelf name = case _ of
  RCallKnown callee _ -> callee == name
  _ -> false

callsClosure :: Rhs -> Boolean
callsClosure = case _ of
  RApply _ _ -> true
  -- These primitives apply a closure directly or through a runtime helper;
  -- MkEffectFn, in contrast, is only the identity and need not be rejected.
  RPrim RunEffectFn _ -> true
  RPrim UnsafePartial _ -> true
  RPrim FromNumberImpl _ -> true
  RPrim RefNewWithSelf _ -> true
  RPrim RefModify _ -> true
  RPrim ForE _ -> true
  RPrim ForeachE _ -> true
  RPrim WhileE _ -> true
  RPrim UntilE _ -> true
  _ -> false

anyRhs :: (Rhs -> Boolean) -> AnfExpr -> Boolean
anyRhs predicate = go
  where
  go = case _ of
    Return _ -> false
    Let _ _ rhs k -> predicate rhs || go k
    Switch _ branches dflt -> any (\(Branch _ b) -> go b) branches || maybe false go dflt
    LitSwitch _ branches dflt -> any (\(LitBranch _ b) -> go b) branches || maybe false go dflt
    LetRec _ k -> go k
    LetJoin _ _ producer k -> go producer || go k
