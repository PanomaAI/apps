/*
  Import this module FIRST, then import scenes dynamically: a static import of a .tsx
  file is resolved while the module graph links, before any registration code runs,
  and fails with a syntax error that points at an innocent angle bracket.

  registerHooks (not the deprecated register()) keeps the transform in-thread and
  synchronous — Node strips types natively, and this hook adds the one thing it
  won't do: JSX. This is the entire build system.
*/
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith(".tsx")) return nextLoad(url, context);
    const source = readFileSync(fileURLToPath(url), "utf8");
    const out = ts.transpileModule(source, {
      fileName: url,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    return { format: "module", shortCircuit: true, source: out.outputText };
  },
});
