module Test.Unit.PureScript.Backend.Wasm.Lower.TypedWorkers (spec) where

import Prelude

import Data.Array as Array
import Data.Foldable (for_)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import PureScript.Backend.Wasm.Intrinsics (Intrinsic(..))
import PureScript.Backend.Wasm.Lower.IR (AnfExpr(..), Atom(..), Branch(..), FuncName(..), IRFunc, LitBranch(..), LitPat(..), Rep(..), Rhs(..), Slot(..), VarRef(..))
import PureScript.Backend.Wasm.Lower.TypedWorkers (splitIntWorkers)
import PureScript.Backend.Wasm.Lower.Unbox (TyRep(..))
import PureScript.CoreFn (ExprType(..))
import Test.Spec (Spec, describe, it)
import Test.Spec.Assertions (shouldEqual)

name :: FuncName
name = FuncName "T.recur"

arg :: Atom
arg = AVar (Local (Slot 0))

recur :: AnfExpr
recur = Let (Slot 3) Boxed (RCallKnown name [ arg ]) (Return (AVar (Local (Slot 3))))

withApply :: AnfExpr
withApply = Let (Slot 2) Boxed (RApply (AVar (Local (Slot 1))) arg) recur

function :: AnfExpr -> IRFunc
function body =
  { name
  , params: [ Boxed ]
  , result: Boxed
  , body: Let (Slot 1) Boxed (RMkClosure (FuncName "T.callback") []) body
  , export: Just "recur"
  , localCount: 6
  , forcedReps: Map.empty
  }

spec :: Spec Unit
spec = describe "PureScript.Backend.Wasm.Lower.TypedWorkers" do
  let
    types = Map.singleton name (TypeFunc [ TypeInt ] TypeInt)
    pins = Map.singleton name { params: [ Bx ], result: Bx }
    contexts =
      [ Tuple "body" identity
      , Tuple "continuation after a recursive call"
          (Let (Slot 4) Boxed (RCallKnown name [ arg ]))
      , Tuple "constructor branch" (\b -> Switch arg [ Branch 0 b ] (Just (Return arg)))
      , Tuple "constructor default" (\b -> Switch arg [] (Just b))
      , Tuple "literal branch" (\b -> LitSwitch arg [ LitBranch (PInt 0) b ] (Just (Return arg)))
      , Tuple "literal default" (\b -> LitSwitch arg [] (Just b))
      , Tuple "recursive closure continuation" (LetRec [])
      , Tuple "join producer" (\b -> LetJoin (Slot 5) Boxed b (Return (AVar (Local (Slot 5)))))
      , Tuple "join continuation" (LetJoin (Slot 5) Boxed (Return arg))
      ]
  for_ contexts \(Tuple label wrap) -> do
    it ("keeps opaque closure application on the boxed path: " <> label) do
      let
        fn = function (wrap withApply)
        result = splitIntWorkers types pins [ fn ]
      Array.length result.funcs `shouldEqual` 1
      result.pins `shouldEqual` pins
      (map _.params result.funcs) `shouldEqual` [ [ Boxed ] ]
      (map (show <<< _.body) result.funcs) `shouldEqual` [ show fn.body ]
    it ("still specialises direct recursion: " <> label) do
      let result = splitIntWorkers types pins [ function (wrap recur) ]
      Array.length result.funcs `shouldEqual` 2
      (map _.params result.funcs) `shouldEqual` [ [ Boxed ], [ I32 ] ]

  -- The uncurried spelling and runtime callback intrinsics also emit closure
  -- applications, even though they are represented by RPrim rather than RApply.
  for_ [ RunEffectFn, UnsafePartial, FromNumberImpl, RefNewWithSelf, RefModify, ForE, ForeachE, WhileE, UntilE ] \prim ->
    it ("keeps callback intrinsic on the boxed path: " <> show prim) do
      let
        body = Let (Slot 2) Boxed (RPrim prim [ AVar (Local (Slot 1)), arg ]) recur
        result = splitIntWorkers types pins [ function body ]
      Array.length result.funcs `shouldEqual` 1

  it "does not reject ordinary scalar primitives" do
    let
      body = Let (Slot 2) I32 (RPrim IntAdd [ arg, ALitInt 1 ]) recur
      result = splitIntWorkers types pins [ function body ]
    Array.length result.funcs `shouldEqual` 2
