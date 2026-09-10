/**
 * MCP OAuth 2.0 PKCE token vault (ADR 0210, issue #96).
 *
 * Remote MCP endpoints (Notion, Jira, Linear) answer 401 until the client
 * completes an RFC 7636 code flow. This module owns that half:
 *
 * - `beginMcpOAuth` builds the authorize URL + verifier/state pair;
 * - `completeMcpOAuth` exchanges the code; `refreshMcpOAuth` rotates;
 * - `McpOAuthVault` keeps access tokens in memory, persists refresh tokens
 *   in host-core's encrypted secret store (`secret:mcp:<id>:oauth`), and
 *   injects `Authorization` headers into remote transports with refresh-once
 *   retry on 401.
 *
 * Refresh tokens never leave the main process. The browser/callback half of
 * the login follows the provider OAuth UX in `oauth.ts`.
 */

import {
  codeChallengeS256,
  createCodeVerifier,
  mcpAuthorizeUrl,
} from "@pi-desktop/shared";

/** Mirrors `secret_ref_for_mcp_oauth` in crates/host-core/src/secrets.rs. */
export function secretRefForMcpOauth(serverId: string): string {
  return `secret:mcp:${serverId}:oauth`;
}

export type McpOAuthConfig = {
  authorizeEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
};

export type McpOAuthBegin = {
  url: string;
  verifier: string;
  state: string;
};

export type McpOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Seconds until access expiry, when the server reports it. */
  expiresIn?: number;
};

/** Start PKCE login: open `url`, finish with `completeMcpOAuth`. */
export async function beginMcpOAuth(
  config: McpOAuthConfig,
  state?: string,
): Promise<McpOAuthBegin> {
  const verifier = createCodeVerifier();
  const challenge = await codeChallengeS256(verifier);
  const resolvedState =
    state ?? `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return {
    url: mcpAuthorizeUrl({ ...config, state: resolvedState, challenge }),
    verifier,
    state: resolvedState,
  };
}

async function tokenRequest(
  tokenEndpoint: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<McpOAuthTokens> {
  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`mcp oauth token endpoint returned ${response.status}`), {
      code: "OAUTH_TOKEN",
    });
  }
  const data = (await response.json()) as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string" ? data.access_token : "";
  if (!accessToken) {
    throw Object.assign(new Error("mcp oauth response has no access_token"), {
      code: "OAUTH_TOKEN",
    });
  }
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

/** Exchange an authorization code for tokens. */
export function completeMcpOAuth(
  input: {
    tokenEndpoint: string;
    clientId: string;
    code: string;
    verifier: string;
    redirectUri: string;
  },
  fetchImpl?: typeof fetch,
): Promise<McpOAuthTokens> {
  return tokenRequest(
    input.tokenEndpoint,
    {
      grant_type: "authorization_code",
      client_id: input.clientId,
      code: input.code,
      code_verifier: input.verifier,
      redirect_uri: input.redirectUri,
    },
    fetchImpl,
  );
}

/** Rotate an expired access token. */
export function refreshMcpOAuth(
  input: { tokenEndpoint: string; clientId: string; refreshToken: string },
  fetchImpl?: typeof fetch,
): Promise<McpOAuthTokens> {
  return tokenRequest(
    input.tokenEndpoint,
    {
      grant_type: "refresh_token",
      client_id: input.clientId,
      refresh_token: input.refreshToken,
    },
    fetchImpl,
  );
}

export type McpSecretsLike = {
  get: (secretRef: string) => Promise<string | undefined>;
  set: (secretRef: string, value: string) => Promise<unknown>;
  delete: (secretRef: string) => Promise<unknown>;
};

/**
 * Per-server token vault. Access tokens stay in memory with a 60s expiry
 * margin; refresh tokens persist encrypted. `headers()` never throws —
 * callers send unauthenticated when no grant exists yet.
 */
export class McpOAuthVault {
  private accessToken: string | undefined;
  private expiresAt = 0;
  private readonly serverId: string;
  private readonly config: McpOAuthConfig;
  private readonly secrets: McpSecretsLike;
  private readonly fetchImpl: typeof fetch;

  constructor(
    serverId: string,
    config: McpOAuthConfig,
    secrets: McpSecretsLike,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.serverId = serverId;
    this.config = config;
    this.secrets = secrets;
    this.fetchImpl = fetchImpl;
  }

  /** Persist a fresh grant (login completion). */
  async storeGrant(tokens: McpOAuthTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.expiresAt =
      Date.now() + Math.max(0, (tokens.expiresIn ?? 3600) - 60) * 1000;
    if (tokens.refreshToken) {
      await this.secrets.set(secretRefForMcpOauth(this.serverId), tokens.refreshToken);
    }
  }

  /** Forget the grant (disconnect / revoke). */
  async clear(): Promise<void> {
    this.accessToken = undefined;
    this.expiresAt = 0;
    await this.secrets.delete(secretRefForMcpOauth(this.serverId)).catch(() => undefined);
  }

  /** Bearer headers for remote transports, refreshing once when stale. */
  async headers(): Promise<Record<string, string>> {
    if (!this.accessToken || Date.now() >= this.expiresAt) {
      const refreshToken = await this.secrets
        .get(secretRefForMcpOauth(this.serverId))
        .catch(() => undefined);
      if (!refreshToken) return {};
      try {
        const rotated = await refreshMcpOAuth(
          {
            tokenEndpoint: this.config.tokenEndpoint,
            clientId: this.config.clientId,
            refreshToken,
          },
          this.fetchImpl,
        );
        await this.storeGrant(rotated);
      } catch {
        return this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {};
      }
    }
    return this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {};
  }

  /**
   * True when the vault refreshed around a 401 and the call deserves one
   * retry. Forces expiry first so `headers()` rotates even a valid-looking
   * token the server already rejected.
   */
  async refreshForRetry(): Promise<boolean> {
    this.expiresAt = 0;
    const headers = await this.headers();
    return "authorization" in headers;
  }
}
