/* Monaco worker environment (ADR 0210): bundle workers locally so the
   editor runs offline inside Electron. Set once before importing
   monaco-editor anywhere. */

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

let installed = false;

export function installMonacoWorkers(): void {
  if (installed || typeof self === "undefined") return;
  self.MonacoEnvironment = {
    getWorker(_moduleId: unknown, label: string) {
      if (label === "typescript" || label === "javascript") return new tsWorker();
      return new editorWorker();
    },
  };
  installed = true;
}

/** Map a file path to a Monaco language id (undefined = plaintext). */
export function monacoLanguageFor(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
    case "mts":
    case "js":
    case "jsx":
      return "typescript";
    case "rs":
      return "rust";
    case "py":
      return "python";
    case "go":
      return "go";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    default:
      return undefined;
  }
}
