module Test.Unit.PureScript.Backend.Wasm.Lower.Unbox (spec) where

import Prelude hiding (identity)

import Data.Array as Array
import Data.Map as Map
import Data.Maybe (Maybe(..))
import PureScript.Backend.Wasm.Lower.IR (AnfExpr(..), Atom(..), FuncName(..), IRFunc, Rep(..), Rhs(..), Slot(..), VarRef(..))
import PureScript.Backend.Wasm.Lower.Unbox (TyRep(..), assignProgramReps)
import Test.Spec (Spec, describe, it)
import Test.Spec.Assertions (shouldEqual)

identity :: Rep -> IRFunc
identity rep =
  { name: FuncName "T.identity"
  , params: [ rep ]
  , result: Boxed
  , body: Return (AVar (Local (Slot 0)))
  , export: Nothing
  , localCount: 1
  , forcedReps: Map.empty
  }

caller :: String -> Atom -> IRFunc
caller name arg =
  { name: FuncName name
  , params: []
  , result: Boxed
  , body: Let (Slot 0) Boxed (RCallKnown (FuncName "T.identity") [ arg ])
      (Return (AVar (Local (Slot 0))))
  , export: Nothing
  , localCount: 1
  , forcedReps: Map.empty
  }

signature :: IRFunc -> { params :: Array Rep, result :: Rep }
signature fn = { params: fn.params, result: fn.result }

spec :: Spec Unit
spec = describe "PureScript.Backend.Wasm.Lower.Unbox" do
  it "infers Int parameters and results without TAST hints" do
    let inferred = assignProgramReps Map.empty [ identity Boxed, caller "T.main" (ALitInt 42) ]
    map signature inferred `shouldEqual`
      [ { params: [ I32 ], result: I32 }, { params: [], result: I32 } ]

  it "infers Number parameters and results without TAST hints" do
    let inferred = assignProgramReps Map.empty [ identity Boxed, caller "T.main" (ALitNumber 1.5) ]
    map signature inferred `shouldEqual`
      [ { params: [ F64 ], result: F64 }, { params: [], result: F64 } ]

  it "joins heterogeneous calls to a boxed signature" do
    let
      inferred = assignProgramReps Map.empty
        [ identity Boxed, caller "T.int" (ALitInt 42), caller "T.number" (ALitNumber 1.5) ]
    (signature <$> Array.head inferred) `shouldEqual` Just { params: [ Boxed ], result: Boxed }

  it "does not infer a scalar from an unknown caller value" do
    let inferred = assignProgramReps Map.empty [ identity Boxed, caller "T.main" (ALitString "hello") ]
    (signature <$> Array.head inferred) `shouldEqual` Just { params: [ Boxed ], result: Boxed }

  it "keeps an explicit boxed ABI despite scalar call-site evidence" do
    let
      pins = Map.singleton (FuncName "T.identity") { params: [ Bx ], result: Bx }
      inferred = assignProgramReps pins [ identity Boxed, caller "T.main" (ALitInt 42) ]
    map signature inferred `shouldEqual`
      [ { params: [ Boxed ], result: Boxed }, { params: [], result: Boxed } ]

  it "retains a known scalar hint with no visible callers" do
    map signature (assignProgramReps Map.empty [ identity I32 ]) `shouldEqual`
      [ { params: [ I32 ], result: I32 } ]

  it "does not invent a scalar type when there is no hint or caller" do
    map signature (assignProgramReps Map.empty [ identity Boxed ]) `shouldEqual`
      [ { params: [ Boxed ], result: Boxed } ]

  it "propagates scalar evidence through a self-recursive signature" do
    let
      fn = (identity Boxed)
        { body = LitSwitch (AVar (Local (Slot 0))) []
            ( Just
                ( Let (Slot 1) Boxed (RCallKnown (FuncName "T.identity") [ AVar (Local (Slot 0)) ])
                    (Return (AVar (Local (Slot 0))))
                )
            )
        , localCount = 2
        }
      inferred = assignProgramReps Map.empty [ fn, caller "T.main" (ALitInt 42) ]
    (signature <$> Array.head inferred) `shouldEqual` Just { params: [ I32 ], result: I32 }
