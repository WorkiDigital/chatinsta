import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getBaseUrl, requireEnv } from "@/lib/env";

export const MCP_OAUTH_SCOPES = [
  "flows:read",
  "flows:write",
  "offline_access",
] as const;

export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const MCP_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MCP_AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const AUTHORIZATION_INTENT_TTL_SECONDS = 10 * 60;

export type McpAuthorizationParams = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  state?: string;
};

type AuthorizationIntent = McpAuthorizationParams & {
  userId: string;
  workspaceId: string;
  expiresAt: number;
};

type ValidationResult =
  | { success: true; data: McpAuthorizationParams }
  | { success: false; error: string; description: string };

export function getOAuthIssuer(): string {
  return new URL(getBaseUrl()).origin;
}

export function getMcpResourceUrl(): string {
  return new URL("/api/mcp", getOAuthIssuer()).toString();
}

export function getProtectedResourceMetadataUrl(): string {
  return new URL(
    "/.well-known/oauth-protected-resource",
    getOAuthIssuer()
  ).toString();
}

export function getAllowedChatGptRedirectUri(clientId: string): string | null {
  if (clientId === "https://chatgpt.com/oauth/client.json") {
    return "https://chatgpt.com/connector_platform_oauth_redirect";
  }

  const match = /^https:\/\/chatgpt\.com\/oauth\/([^/?#]+)\/client\.json$/.exec(
    clientId
  );
  if (!match) return null;

  const callbackId = match[1];
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(callbackId)) return null;
  return `https://chatgpt.com/connector/oauth/${callbackId}`;
}

export function validateAuthorizationParams(
  params: URLSearchParams
): ValidationResult {
  if (params.get("response_type") !== "code") {
    return {
      success: false,
      error: "unsupported_response_type",
      description: "Only the authorization code flow is supported.",
    };
  }

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const expectedRedirect = getAllowedChatGptRedirectUri(clientId);
  if (!expectedRedirect || redirectUri !== expectedRedirect) {
    return {
      success: false,
      error: "invalid_request",
      description: "The ChatGPT client or redirect URI is not allowed.",
    };
  }

  const resource = params.get("resource") ?? "";
  if (resource !== getMcpResourceUrl()) {
    return {
      success: false,
      error: "invalid_target",
      description: "The OAuth resource does not match this MCP server.",
    };
  }

  const codeChallenge = params.get("code_challenge") ?? "";
  if (
    params.get("code_challenge_method") !== "S256" ||
    !PKCE_CHALLENGE.test(codeChallenge)
  ) {
    return {
      success: false,
      error: "invalid_request",
      description: "A valid S256 PKCE challenge is required.",
    };
  }

  // Many OAuth clients, ChatGPT's connector included, either omit `scope`
  // entirely or request only a subset of what a server advertises, expecting
  // the server to grant a sensible default or the requested subset — not
  // reject the request outright. Scopes are informational only today (no
  // code gates MCP tool access by them; see app/api/mcp/route.ts), so the
  // only thing worth rejecting here is a scope the server has never heard
  // of. An empty request grants the full default set.
  const requestedScopes = [
    ...new Set((params.get("scope") ?? "").split(/\s+/).filter(Boolean)),
  ];
  const unsupported = requestedScopes.filter(
    (scope) => !(MCP_OAUTH_SCOPES as readonly string[]).includes(scope)
  );
  if (unsupported.length > 0) {
    return {
      success: false,
      error: "invalid_scope",
      description: `Unsupported scope(s): ${unsupported.join(" ")}. Supported scopes: ${MCP_OAUTH_SCOPES.join(" ")}.`,
    };
  }
  const scopes = requestedScopes.length > 0 ? requestedScopes : [...MCP_OAUTH_SCOPES];

  const state = params.get("state") ?? undefined;
  if (state && state.length > 2048) {
    return {
      success: false,
      error: "invalid_request",
      description: "The OAuth state value is too long.",
    };
  }

  return {
    success: true,
    data: {
      clientId,
      redirectUri,
      codeChallenge,
      scopes,
      resource,
      state,
    },
  };
}

function intentSecret(): string {
  return requireEnv("NEXTAUTH_SECRET");
}

export function createAuthorizationIntent(
  params: McpAuthorizationParams,
  userId: string,
  workspaceId: string
): string {
  const payload: AuthorizationIntent = {
    ...params,
    userId,
    workspaceId,
    expiresAt: Math.floor(Date.now() / 1000) + AUTHORIZATION_INTENT_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", intentSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyAuthorizationIntent(
  value: string
): AuthorizationIntent | null {
  const [encoded, suppliedSignature, extra] = value.split(".");
  if (!encoded || !suppliedSignature || extra) return null;

  const expectedSignature = createHmac("sha256", intentSecret())
    .update(encoded)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, "base64url");
  } catch {
    return null;
  }
  if (
    supplied.length !== expectedSignature.length ||
    !timingSafeEqual(supplied, expectedSignature)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as AuthorizationIntent;
    if (
      !parsed.userId ||
      !parsed.workspaceId ||
      !parsed.clientId ||
      !parsed.redirectUri ||
      !parsed.resource ||
      !parsed.codeChallenge ||
      !Array.isArray(parsed.scopes) ||
      parsed.expiresAt < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hashOAuthSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateAuthorizationCode(): string {
  return `imcpc_${randomBytes(32).toString("base64url")}`;
}

export function generateOAuthTokens(): {
  accessToken: string;
  refreshToken: string;
} {
  return {
    accessToken: `imcpo_${randomBytes(32).toString("base64url")}`,
    refreshToken: `imcpr_${randomBytes(32).toString("base64url")}`,
  };
}

export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  if (!PKCE_VERIFIER.test(codeVerifier) || !PKCE_CHALLENGE.test(codeChallenge)) {
    return false;
  }
  const actual = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(codeChallenge);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function buildAuthorizationRedirect(
  redirectUri: string,
  values: Record<string, string | undefined>
): URL {
  const destination = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) destination.searchParams.set(key, value);
  }
  return destination;
}

export function oauthJsonResponse(
  body: Record<string, unknown>,
  status = 200
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

export function oauthError(
  error: string,
  description: string,
  status = 400
): Response {
  return oauthJsonResponse({ error, error_description: description }, status);
}
