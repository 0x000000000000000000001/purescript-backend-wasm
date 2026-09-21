-- | Round-trip tests for the `.pmi` interface container: the cache header (key + deps + summary,
-- | ADR 0034) AND the lowering interface (funcs/ctors/dictCtors/enumCtors/foreignSigs/foreignNames/
-- | labels, ADR 0038 Phase B). Checks that every field — including a `CtorInfo` with mixed
-- | `fieldReps` and a deeply-nested recursive `MarshalKind` — survives a round-trip, and that a
-- | non-`.pmi` byte string (e.g. a raw MIR encoding) is rejected.
module Test.Unit.PureScript.Backend.Wasm.MiddleEnd.Serialize.Pmifile (spec) where

import Prelude

import Data.Either (Either(..), isLeft)
import Data.Foldable (traverse_)
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))
import Effect.Class (liftEffect)
import Foreign.Object as Object
import PureScript.Backend.Wasm.Lower.IR (MarshalKind(..), Rep(..))
import PureScript.Backend.Wasm.MiddleEnd.IR as M
import PureScript.Backend.Wasm.MiddleEnd.Serialize (encode)
import PureScript.Backend.Wasm.MiddleEnd.Serialize.Bytes (finish, newWriter, putU8)
import PureScript.Backend.Wasm.MiddleEnd.Serialize.Pmifile (PmiEntry, decodePmi, encodePmi)
import PureScript.CoreFn (ExprType(..), Qualified(..))
import Test.Spec (Spec, describe, it)
import Test.Spec.Assertions (shouldEqual)

summaryMod :: M.Module
summaryMod = { name: [ "Data", "Demo" ], decls: [ M.NonRec Nothing Nothing "go" (M.Var (Qualified Nothing "x")) ] }

-- a recursive marshalling kind exercising every constructor (incl. the nested record/array/func/effect)
nestedKind :: MarshalKind
nestedKind = MEffect (MArray (MFunc MStr (MRecord [ Tuple "n" MI32, Tuple "ok" MBool, Tuple "raw" MOpaque ])))

entry :: PmiEntry
entry =
  { sourceHash: "0011223344556677"
  , key: "deadbeefcafef00d"
  , deps: [ "Data.Dep.A", "Data.Dep.B" ]
  , summary: summaryMod
  , funcs: Object.fromFoldable [ Tuple "Data.Demo.go" 2, Tuple "Data.Demo.id" 1 ]
  , ctors: Object.fromFoldable
      [ Tuple "Data.Demo.Red" { tag: 0, arity: 0, fieldReps: [] }
      , Tuple "Data.Demo.Pair" { tag: 1, arity: 2, fieldReps: [ I32, Boxed ] }
      , Tuple "Data.Demo.Wrap" { tag: 0, arity: 1, fieldReps: [ F64 ] }
      ]
  , dictCtors: Object.fromFoldable [ Tuple "Data.Demo.eqDemo" unit ]
  , enumCtors: Object.fromFoldable [ Tuple "Data.Demo.Red" unit ]
  , foreignSigs: Object.fromFoldable
      [ Tuple "Data.Demo.raw"
          { moduleName: "Data.Demo", base: "raw", params: [ MStr, MArray MI32 ], result: nestedKind }
      ]
  , foreignNames: [ "Data.Demo.raw" ]
  , labels: Object.fromFoldable [ Tuple "n" 1234, Tuple "ok" 5678 ]
  }

spec :: Spec Unit
spec = describe "PureScript.Backend.Wasm.MiddleEnd.Serialize.Pmifile" do
  it "round-trips a full interface entry (header + summary + lowering tables)" do
    decodePmi (encodePmi entry) `shouldEqual` Right entry

  it "preserves optional TAST types in cached summaries" do
    let
      typed = entry
        { summary = summaryMod
            { decls =
                [ M.NonRec Nothing (Just (TypeFunc [ TypeInt, TypeNumber ] (TypeArray TypeInt)))
                    "worker"
                    (M.Var (Qualified Nothing "x"))
                , M.Rec [ { meta: Nothing, type: Just TypeInt, ident: "value", expr: M.Var (Qualified Nothing "x") } ]
                ]
            }
        }
    decodePmi (encodePmi typed) `shouldEqual` Right typed

  it "round-trips an entry with no dependencies and empty interface tables" do
    let
      e = entry
        { deps = []
        , funcs = Object.empty
        , ctors = Object.empty
        , dictCtors = Object.empty
        , enumCtors = Object.empty
        , foreignSigs = Object.empty
        , foreignNames = []
        , labels = Object.empty
        }
    decodePmi (encodePmi e) `shouldEqual` Right e

  it "rejects a non-.pmi byte string (a raw MIR encoding)" do
    isLeft (decodePmi (encode summaryMod)) `shouldEqual` true

  it "rejects the previous format before attempting to decode its body" do
    bytes <- liftEffect do
      w <- newWriter
      traverse_ (putU8 w) [ 0x50, 0x57, 0x50, 0x4D, 0x49, 2 ]
      finish w
    decodePmi bytes `shouldEqual` Left "unsupported .pmi version: 2"
