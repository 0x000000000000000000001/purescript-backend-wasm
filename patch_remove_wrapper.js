const fs = require('fs');
const file = 'compiler/src/PureScript/Backend/Wasm/Lower.purs';
let content = fs.readFileSync(file, 'utf8');

const target = `          let dummyArgs = map (\\f -> M.Var (Qualified Nothing f)) frees <> map (\\p -> M.Var (Qualified Nothing p)) params
          let callExpr = M.App (M.Var (Qualified Nothing dummyIdent)) dummyArgs
          let wrapperBody = Array.foldr (\\p innerBody -> M.Abs [p] innerBody) callExpr params

          { codeName: wrapperCodeName, captures: wrapperCaptures } <- liftLambda (Just r.ident) envWithDummy (unsafePartial Array.head params) (reAbs (unsafePartial Array.tail params) wrapperBody)
          
          bindRhs (RMkClosure wrapperCodeName wrapperCaptures) \\fAtom ->
            lowerCoreLetK (env { directLocals = Object.insert r.ident { codeName: directName, captures: map AVar freesIR, arity: directArity } env.directLocals, locals = Object.insert r.ident fAtom env.locals }) tail body finish`;

const replacement = `          lowerCoreLetK (env { directLocals = Object.insert r.ident { codeName: directName, captures: map AVar freesIR, arity: directArity } env.directLocals }) tail body finish`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content);
  console.log("Patched successfully!");
} else {
  console.log("Target not found!");
}
