import fs from 'fs';
const f = 'compiler/src/PureScript/Backend/Wasm/Lower/Unbox.purs';
let content = fs.readFileSync(f, 'utf8');
content = content.replace(
  "  unboxModule m = let sigs = deriveSigs m.decls in let _ = unsafePerformEffect (Console.log (show (Map.toUnfoldable sigs :: Array (Tuple String Sig)))) in m { decls = map (unboxBind sigs) m.decls }",
  "  unboxModule m = let sigs = deriveSigs m.decls in let _ = unsafePerformEffect (Node.FS.Sync.writeTextFile Node.Encoding.UTF8 (\"/tmp/sigs_\" <> m.name <> \".txt\") (show (Map.toUnfoldable sigs :: Array (Tuple String Sig)))) in m { decls = map (unboxBind sigs) m.decls }"
);
content = "import Node.FS.Sync as Node.FS.Sync\nimport Node.Encoding as Node.Encoding\n" + content;
fs.writeFileSync(f, content);
