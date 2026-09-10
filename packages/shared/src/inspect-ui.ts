/**
 * `inspect_ui` contract: desktop-exclusive UI inspection for frontend work
 * (ADR 0209).
 *
 * The Electron webview hosts the dev server; the tool takes a DOM snapshot +
 * computed styles for a selector, captures a screenshot buffer, and returns
 * both into agent context for multimodal comparison. This module owns the
 * wire shapes and validation so main, renderer, and sidecar agree.
 */

export type InspectAction =
  | { kind: "snapshot"; selector: string }
  | { kind: "screenshot"; selector?: string }
  | { kind: "diff"; base: string; next: string };

export type InspectRequest = {
  url: string;
  actions: InspectAction[];
};

export type DomSnapshot = {
  selector: string;
  html: string;
  /** Computed styles keyed by `property`. */
  styles: Record<string, string>;
};

export type InspectResult = {
  snapshots: DomSnapshot[];
  /** PNG buffers, base64. */
  screenshots: string[];
  /** FNV checksum per screenshot for cheap change detection. */
  checksums: string[];
};

/** True for http(s) dev-server URLs only — no file:// or remote hosts. */
export function isInspectableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/** Validate a request before it reaches the webview host. */
export function validateInspectRequest(req: InspectRequest): string | undefined {
  if (!isInspectableUrl(req.url)) return "url must be a loopback http(s) dev server";
  if (!req.actions.length) return "at least one action is required";
  if (req.actions.length > 8) return "at most 8 actions per call";
  for (const action of req.actions) {
    if (action.kind === "snapshot" && !action.selector.trim()) {
      return "snapshot requires a selector";
    }
  }
  return undefined;
}

/** FNV-1a checksum for screenshot change detection. */
export function screenshotChecksum(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
