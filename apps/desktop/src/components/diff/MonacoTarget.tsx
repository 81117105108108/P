import { useEffect, useRef, useState } from "react";
import { installMonacoWorkers, monacoLanguageFor } from "./monacoEnv";

/* Monaco-backed editable buffer with a plain textarea fallback (ADR 0210).
   The editor loads lazily so review surfaces mount instantly; when the
   bundle is unavailable (or fails), the same value stays editable. */

export type MonacoTargetProps = {
  value: string;
  onChange?: (value: string) => void;
  filePath?: string;
  className?: string;
  ariaLabel?: string;
  rows?: number;
};

export function MonacoTarget({
  value,
  onChange,
  filePath,
  className,
  ariaLabel,
  rows = 8,
}: MonacoTargetProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ dispose: () => void } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    installMonacoWorkers();
    import("monaco-editor")
      .then((monaco) => {
        if (cancelled || !hostRef.current || editorRef.current) return;
        const editor = monaco.editor.create(hostRef.current, {
          value: valueRef.current,
          language: filePath ? monacoLanguageFor(filePath) : undefined,
          theme: "vs-dark",
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
        });
        editorRef.current = editor;
        editor.onDidChangeModelContent(() => {
          onChangeRef.current?.(editor.getValue());
        });
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });
    return () => {
      cancelled = true;
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, [filePath]);

  useEffect(() => {
    // External cherry-picks flow into a live editor without clobbering the
    // caret when the user is typing.
    const editor = editorRef.current as unknown as {
      getValue: () => string;
      setValue: (v: string) => void;
    } | null;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  if (fallback) {
    return (
      <textarea
        className={className}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        rows={rows}
      />
    );
  }
  return <div ref={hostRef} className={className} aria-label={ariaLabel} role="textbox" style={{ minHeight: rows * 22 }} />;
}
