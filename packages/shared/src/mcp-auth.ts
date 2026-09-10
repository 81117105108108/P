/**
 * MCP OAuth PKCE helpers, RFC 7636 (ADR 0208, issue #96).
 *
 * The code path (authorize → code → token exchange) runs in Electron main;
 * tokens persist in the OS keychain via the existing secrets adapter, never in
 * plaintext config. This module owns only the pure transforms so they are
 * unit-testable on every surface.
 */

const CODE_VERIFIER_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** Random `code_verifier` (43–128 chars). Pass `random` in tests. */
export function createCodeVerifier(
  length = 64,
  random: () => number = Math.random,
): string {
  const n = Math.max(43, Math.min(128, Math.floor(length)));
  let out = "";
  for (let i = 0; i < n; i++) {
    out += CODE_VERIFIER_CHARS[Math.floor(random() * CODE_VERIFIER_CHARS.length)];
  }
  return out;
}

/** BASE64URL(SHA256(verifier)) — async to use WebCrypto where available. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

export function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Authorization URL with PKCE params for a remote MCP endpoint. */
export function mcpAuthorizeUrl(input: {
  authorizeEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(input.authorizeEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", input.state);
  if (input.scope?.trim()) url.searchParams.set("scope", input.scope.trim());
  return url.toString();
}
