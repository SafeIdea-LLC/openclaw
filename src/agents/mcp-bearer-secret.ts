/**
 * Static SecretRef-backed bearer token resolution for HTTP MCP servers.
 *
 * Distinct from OAuth (`mcp-oauth*.ts`) and auth-profile bearer injection
 * (`mcp-auth-profile.ts`): the token here is a single operator-configured
 * SecretInput (literal string or SecretRef) resolved once per transport and
 * never persisted, rather than a refreshable credential.
 */
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveSecretInputRef } from "../config/types.secrets.js";
import { formatErrorMessage } from "../infra/errors.js";
import { materializeSecretInput } from "../secrets/resolve-secret-input-string.js";
import { withoutMcpAuthorizationHeader } from "./mcp-http-fetch.js";

/** Returns the configured `bearerToken` SecretInput, if any, from raw server config. */
export function resolveMcpServerBearerTokenInput(rawServer: unknown): unknown {
  if (!isRecord(rawServer)) {
    return undefined;
  }
  return rawServer.bearerToken;
}

/**
 * Returns whether a configured `bearerToken` resolves to a store-backed SecretRef.
 * The protected secret store lives beside the Gateway; runtimes without access to
 * it (the headless node host) must refuse these servers instead of retrying forever.
 */
export function isMcpServerBearerTokenStoreBacked(rawServer: unknown): boolean {
  const value = resolveMcpServerBearerTokenInput(rawServer);
  if (value === undefined) {
    return false;
  }
  const { ref } = resolveSecretInputRef({ value });
  return ref?.source === "store";
}

/** Resolves a configured bearerToken SecretInput into a plaintext token string. */
export async function resolveMcpBearerSecretToken(params: {
  serverName: string;
  value: unknown;
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const token = await materializeSecretInput({
    // SAFETY: a full SecretRef always carries its own provider, so the empty fallback's absent secrets.defaults is never consulted.
    config: params.cfg ?? ({} as OpenClawConfig),
    value: params.value,
    env: params.env ?? process.env,
    onResolveRefError: (error): never => {
      throw new Error(
        `MCP server "${params.serverName}" could not resolve its bearerToken secret reference: ${formatErrorMessage(error)}`,
      );
    },
  });
  if (!token) {
    throw new Error(`MCP server "${params.serverName}" bearerToken resolved to an empty value.`);
  }
  return token;
}

/**
 * Wraps HTTP MCP fetch so a SecretRef-backed bearer token is resolved once
 * (memoized for the transport's lifetime) and injected only for same-origin
 * requests, mirroring the OAuth/auth-profile bearer wrapper shape.
 */
export function withMcpStaticBearerToken(params: {
  fetchFn: FetchLike;
  serverName: string;
  resourceUrl: string;
  headers?: Record<string, string>;
  value: unknown;
  cfg?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): FetchLike {
  const resourceOrigin = new URL(params.resourceUrl).origin;
  const configuredHeaders = withoutMcpAuthorizationHeader(params.headers);
  let tokenPromise: Promise<string> | undefined;
  return async (url, init) => {
    if (new URL(url).origin !== resourceOrigin) {
      return params.fetchFn(url, init);
    }
    const headers = new Headers(configuredHeaders);
    for (const [key, value] of new Headers(init?.headers)) {
      if (key.toLowerCase() !== "authorization") {
        headers.set(key, value);
      }
    }
    tokenPromise ??= resolveMcpBearerSecretToken({
      serverName: params.serverName,
      value: params.value,
      cfg: params.cfg,
      env: params.env,
    });
    const token = await tokenPromise;
    headers.set("authorization", `Bearer ${token}`);
    // SAFETY: mirrors the sibling withMcpAuthProfileBearer wrapper's RequestInit spread.
    return params.fetchFn(url, { ...(init as RequestInit), headers });
  };
}
