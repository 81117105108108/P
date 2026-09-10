import { memo, useState } from "react";
import { cx } from "../ui";
import { MonacoTarget } from "./MonacoTarget";

/* Interactive 3-way hunk review (ADR 0209): base vs worktree vs edited
   target. Hunks carry semantic labels from the AST layer
   ("Modified function resolve_query"); cherry-pick copies one hunk into the
   editable target buffer. Monaco binds later; the hunk model is stable. */

export type DiffHunkDecision = "pending" | "accepted" | "discarded";

export type DiffHunk = {
  id: string;
  /** Semantic label, e.g. "Modified function resolve_query". */
  label: string;
  base: string;
  incoming: string;
};

export type DiffReviewProps = {
  filePath: string;
  hunks: DiffHunk[];
  onAcceptFile?: (target: string) => void;
  onDiscardFile?: () => void;
};

function applyHunk(target: string, hunk: DiffHunk): string {
  return target ? `${target}\n${hunk.incoming}` : hunk.incoming;
}

export const DiffReview = memo(function DiffReview({
  filePath,
  hunks,
  onAcceptFile,
  onDiscardFile,
}: DiffReviewProps) {
  const [decisions, setDecisions] = useState<Record<string, DiffHunkDecision>>({});
  const [target, setTarget] = useState("");

  const cherryPick = (hunk: DiffHunk) => {
    setTarget((prev) => applyHunk(prev, hunk));
    setDecisions((prev) => ({ ...prev, [hunk.id]: "accepted" }));
  };
  const discard = (hunk: DiffHunk) =>
    setDecisions((prev) => ({ ...prev, [hunk.id]: "discarded" }));

  return (
    <section className="diff-review" aria-label={`Review ${filePath}`}>
      <header className="diff-review-head">
        <span className="diff-review-path">{filePath}</span>
        <span className="diff-review-count">
          {hunks.length} {hunks.length === 1 ? "hunk" : "hunks"}
        </span>
      </header>
      {hunks.map((hunk) => {
        const state = decisions[hunk.id] ?? "pending";
        return (
          <article key={hunk.id} className={cx("diff-hunk-card", `is-${state}`)}>
            <div className="diff-hunk-label">{hunk.label}</div>
            <div className="diff-hunk-cols">
              <pre className="diff-hunk-base">{hunk.base}</pre>
              <pre className="diff-hunk-incoming">{hunk.incoming}</pre>
            </div>
            <div className="diff-hunk-actions">
              <button type="button" onClick={() => cherryPick(hunk)} disabled={state === "accepted"}>
                Cherry-pick Hunk
              </button>
              <button type="button" onClick={() => discard(hunk)} disabled={state === "discarded"}>
                Discard
              </button>
            </div>
          </article>
        );
      })}
      <label className="diff-review-target-label">
        Target buffer (editable before accept)
        <MonacoTarget
          className="diff-review-target"
          ariaLabel="Target buffer"
          filePath={filePath}
          value={target}
          onChange={setTarget}
          rows={8}
        />
      </label>
      <footer className="diff-review-foot">
        <button type="button" onClick={() => onAcceptFile?.(target)}>
          Accept File
        </button>
        <button type="button" onClick={() => onDiscardFile?.()}>
          Discard File
        </button>
      </footer>
    </section>
  );
});

export { applyHunk };
