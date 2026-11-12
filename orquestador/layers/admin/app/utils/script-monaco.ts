import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/typescript/register";
import * as typescript from "monaco-editor/languages/features/typescript/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker?worker";
import {
  scriptDiagnosticCodesToIgnore,
  scriptEditorLibrary,
} from "./script-editor-language";

self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === "typescript" || label === "javascript"
      ? new TypeScriptWorker()
      : new EditorWorker(),
};

typescript.typescriptDefaults.setCompilerOptions({
  target: typescript.ScriptTarget.ES2020,
  module: typescript.ModuleKind.ESNext,
  moduleDetection: 3,
  strict: true,
  allowNonTsExtensions: true,
  lib: ["es2020"],
  types: [],
  noEmit: true,
});
typescript.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  diagnosticCodesToIgnore: scriptDiagnosticCodesToIgnore,
});
typescript.typescriptDefaults.addExtraLib(
  scriptEditorLibrary,
  "file:///rpa-runtime.d.ts",
);
typescript.typescriptDefaults.setEagerModelSync(true);

export { monaco };
