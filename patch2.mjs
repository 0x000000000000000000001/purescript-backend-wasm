import fs from 'fs';
const f = 'compiler/src/PureScript/Backend/Wasm/Lower/Unbox.purs';
let content = fs.readFileSync(f, 'utf8');
content = content.replace(
  "  unboxModule m = m { decls = map (unboxBind (deriveSigs m.decls)) m.decls }",
  "  unboxModule m = let sigs = deriveSigs m.decls in let _ = unsafePerformEffect (Console.log (show (Map.toUnfoldable sigs :: Array (Tuple String Sig)))) in m { decls = map (unboxBind sigs) m.decls }"
);
fs.writeFileSync(f, content);
