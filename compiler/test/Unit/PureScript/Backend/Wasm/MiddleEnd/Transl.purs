-- | Unit tests for the CoreFn → middle-IR translation (`MiddleEnd.Transl`). The
-- | structural change worth checking is **uncurrying**; the rest is a faithful
-- | mapping, exercised over the real fixture corpus to confirm it is total.
module Test.Unit.PureScript.Backend.Wasm.MiddleEnd.Transl (spec) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.Foldable (for_)
import Data.Maybe (Maybe(..))
import Effect (Effect)
import Effect.Class (liftEffect)
import PureScript.Backend.Wasm.Compiler (parseModule)
import PureScript.Backend.Wasm.MiddleEnd.IR as M
import PureScript.Backend.Wasm.MiddleEnd.Transl (translBind, translExpr, translModule)
import PureScript.CoreFn as C
import Test.Spec (Spec, describe, it)
import Test.Spec.Assertions (fail, shouldEqual)
import Test.Unit.PureScript.Backend.Wasm.Lower.Common (ann, appE, def, lam, litInt, lv, qv)

foreign import readFixture :: String -> Effect String

spec :: Spec Unit
spec = describe "PureScript.Backend.Wasm.MiddleEnd.Transl (CoreFn -> MIR)" do
  it "uncurries a curried lambda and application" do
    -- \a b -> f a b   →   Abs [a, b] (App (Var f) [a, b])
    case translExpr (lam "a" (lam "b" (appE (appE (qv "f") (lv "a")) (lv "b")))) of
      M.Abs params body -> do
        params `shouldEqual` [ "a", "b" ]
        case body of
          M.App _ args -> Array.length args `shouldEqual` 2
          _ -> fail "expected an App body"
      _ -> fail "expected an uncurried Abs"

  it "leaves a nullary value as a value, not an Abs" do
    -- x = 5   →   NonRec x (Lit …)   (CAFs are not lambdas)
    case translBind (def "x" (litInt 5)) of
      M.NonRec _ _ "x" (M.Lit _) -> pure unit
      _ -> fail "expected NonRec x = Lit"

  it "does not cast an ordinary Array Int parameter to a native i32 array" do
    let typed = ann { type = Just (C.TypeFunc [ C.TypeArray C.TypeInt ] C.TypeInt) }
    translExpr (C.Abs typed "xs" (litInt 42)) `shouldEqual` translExpr (lam "xs" (litInt 42))

  it "does not change array primitive layouts from element types alone" do
    for_ [ C.TypeInt, C.TypeInt64 ] \element -> do
      let
        arrayAnn = ann { type = Just (C.TypeArray element) }
        xs = C.Var arrayAnn (C.Qualified Nothing "xs")
        prim name = C.Var ann (C.Qualified (Just [ "Wasm", "Array" ]) name)
      for_
        [ appE (appE (prim "unsafeIndex") xs) (litInt 0)
        , appE (prim "length") xs
        , appE (appE (appE (prim "unsafeSet") xs) (litInt 0)) (litInt 1)
        , C.App arrayAnn (prim "unsafeNew") (litInt 1)
        ]
        \expr -> case translExpr expr of
          M.App (M.Var (C.Qualified (Just _) name)) _ ->
            Array.elem name [ "unsafeIndex", "length", "unsafeSet", "unsafeNew" ] `shouldEqual` true
          _ -> fail "expected an unchanged generic array primitive"

  it "translates the fixture corpus without partiality (decl count preserved)" do
    for_ corpus \name -> do
      let path = "compiler/test/fixtures/" <> name <> ".corefn.json"
      source <- liftEffect (readFixture path)
      case parseModule source of
        Left err -> fail (name <> ": " <> err)
        Right m -> Array.length (translModule m).decls `shouldEqual` Array.length m.decls

-- A spread of fixtures: every CoreFn node kind (Sample), ADTs (Slice1), arrays
-- (Slice4c), records (Records), dictionaries (Cmp), generics (Gen, GenSC), and an
-- integration program (Expr).
corpus :: Array String
corpus = [ "Sample", "Slice1", "Slice4c", "Records", "Cmp", "Gen", "GenSC", "Expr" ]
