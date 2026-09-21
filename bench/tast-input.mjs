// An explicit input ablation for the current reader: remove type/usage facts,
// retain runtime syntax, including TypeApp wrappers (the translator erases them).
// This is not an emulation of the stock frontend; that is a separate arm.
export function eraseTast(root) {
  const out = structuredClone(root);
  for (const key of ["typeTable", "dataDecls", "classDecls", "foreignAnnotations"]) delete out[key];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node.annotation) {
      delete node.annotation.type;
      delete node.annotation.bindingUsage;
      delete node.annotation.variableUse;
    }
    if (node.type === "TypeApp" && "expression" in node) node.typeArgument = { type: "Unknown" };
    for (const value of Object.values(node)) visit(value);
  };
  visit(out);
  return out;
}

export function annotationCount(root) {
  if (!root || typeof root !== "object") return 0;
  return (root.annotation?.type != null ? 1 : 0) + Object.values(root).reduce((n, v) => n + annotationCount(v), 0);
}
