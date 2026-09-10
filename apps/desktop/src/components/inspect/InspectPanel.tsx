import { memo, useState } from "react";
import type { DomSnapshot } from "@pi-desktop/shared";
import { cx } from "../ui";

/* Multimodal Web DevTools panel (ADR 0209): DOM snapshot + computed styles
   beside the screenshot for one selector. Capture itself rides the Electron
   webview host; this panel renders `inspect_ui` results and flags visual
   drift via checksum comparison. */

export type InspectPanelProps = {
  url: string;
  snapshots: DomSnapshot[];
  screenshots: string[];
  checksums: string[];
};

export const InspectPanel = memo(function InspectPanel({
  url,
  snapshots,
  screenshots,
  checksums,
}: InspectPanelProps) {
  const [active, setActive] = useState(0);
  const snapshot = snapshots[active];
  const drifted = checksums.length > 1 && new Set(checksums).size > 1;

  return (
    <section className="inspect-panel" aria-label={`Inspect ${url}`}>
      <header className="inspect-panel-head">
        <span className="inspect-panel-url">{url}</span>
        {drifted && <span className="inspect-panel-drift">visual drift detected</span>}
      </header>
      <div className="inspect-panel-tabs" role="tablist">
        {snapshots.map((shot, index) => (
          <button
            key={`${shot.selector}-${index}`}
            role="tab"
            aria-selected={index === active}
            type="button"
            className={cx(index === active && "is-active")}
            onClick={() => setActive(index)}
          >
            {shot.selector}
          </button>
        ))}
      </div>
      {snapshot && (
        <div className="inspect-panel-body">
          <pre className="inspect-panel-dom">{snapshot.html.slice(0, 4000)}</pre>
          <dl className="inspect-panel-styles">
            {Object.entries(snapshot.styles)
              .slice(0, 24)
              .map(([prop, value]) => (
                <div key={prop}>
                  <dt>{prop}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {screenshots[active] && (
            <img
              className="inspect-panel-shot"
              alt={`Screenshot of ${snapshot.selector}`}
              src={`data:image/png;base64,${screenshots[active]}`}
            />
          )}
        </div>
      )}
    </section>
  );
});
