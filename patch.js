const fs = require('fs');
const f = 'compiler/src/PureScript/Backend/Wasm/Lower/Unbox.purs';
let content = fs.readFileSync(f, 'utf8');
content = content.replace(
  "  unboxBind s = case _ of",
  "  unboxBind s = let _ = unsafePerformEffect (Console.log (show (Map.toUnfoldable s :: Array (Tuple String Sig)))) in case _ of"
);
content = "import Effect.Unsafe (unsafePerformEffect)\nimport Effect.Class.Console as Console\n" + content;
fs.writeFileSync(f, content);
