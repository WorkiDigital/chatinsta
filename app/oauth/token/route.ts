import { prisma } from "@/lib/db/client";
import {
  generateOAuthTokens,
  getMcpResourceUrl,
  hashOAuthSecret,
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  MCP_REFRESH_TOKEN_TTL_SECONDS,
  oauthError,
  oauthJsonResponse,
  verifyPkce,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

type GrantData = {
  workspaceId: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: string[];
};

function tokenResponse(
  accessToken: string,
  refreshToken: string,
  scopes: string[]
) {
  return oauthJsonResponse({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: MCP_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(" "),
  });
}

function grantRecord(
  data: GrantData,
  accessToken: string,
  refreshToken: string,
  now: Date
) {
  return {
    ...data,
    accessTokenHash: hashOAuthSecret(accessToken),
    refreshTokenHash: hashOAuthSecret(refreshToken),
    accessTokenExpiresAt: new Date(
      now.getTime() + MCP_ACCESS_TOKEN_TTL_SECONDS * 1000
    ),
    refreshTokenExpiresAt: new Date(
      now.getTime() + MCP_REFRESH_TOKEN_TTL_SECONDS * 1000
    ),
  };
}

async function exchangeAuthorizationCode(form: URLSearchParams) {
  const code = form.get("code") ?? "";
  const clientId = form.get("client_id") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const resource = form.get("resource") ?? "";
  const codeVerifier = form.get("code_verifier") ?? "";
  if (!code.startsWith("imcpc_")) {
    return oauthError("invalid_grant", "The authorization code is invalid.");
  }

  const authorizationCode = await prisma.mcpOAuthAuthorizationCode.findUnique({
    where: { codeHash: hashOAuthSecret(code) },
  });
  const now = new Date();
  if (
    !authorizationCode ||
    authorizationCode.consumedAt ||
    authorizationCode.expiresAt <= now ||
    authorizationCode.clientId !== clientId ||
    authorizationCode.redirectUri !== redirectUri ||
    authorizationCode.resource !== resource ||
    resource !== getMcpResourceUrl() ||
    !verifyPkce(codeVerifier, authorizationCode.codeChallenge)
  ) {
    return oauthError("invalid_grant", "The authorization code is invalid or expired.");
  }

  const tokens = generateOAuthTokens();
  try {
    await prisma.$transaction(async (transaction) => {
      const consumed = await transaction.mcpOAuthAuthorizationCode.updateMany({
        where: {
          id: authorizationCode.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new Error("authorization_code_replayed");

      await transaction.mcpOAuthGrant.create({
        data: grantRecord(
          {
            workspaceId: authorizationCode.workspaceId,
            userId: authorizationCode.userId,
            clientId: authorizationCode.clientId,
            resource: authorizationCode.resource,
            scopes: authorizationCode.scopes,
          },
          tokens.accessToken,
          tokens.refreshToken,
          now
        ),
      });
    });
  } catch {
    return oauthError("invalid_grant", "The authorization code was already used.");
  }

  return tokenResponse(
    tokens.accessToken,
    tokens.refreshToken,
    authorizationCode.scopes
  );
}

async function refreshAccessToken(form: URLSearchParams) {
  const refreshToken = form.get("refresh_token") ?? "";
  const clientId = form.get("client_id") ?? "";
  const resource = form.get("resource") ?? "";
  if (!refreshToken.startsWith("imcpr_")) {
    return oauthError("invalid_grant", "The refresh token is invalid.");
  }

  const current = await prisma.mcpOAuthGrant.findUnique({
    where: { refreshTokenHash: hashOAuthSecret(refreshToken) },
  });
  const now = new Date();
  if (
    !current ||
    current.revokedAt ||
    current.refreshTokenExpiresAt <= now ||
    current.clientId !== clientId ||
    current.resource !== resource ||
    resource !== getMcpResourceUrl()
  ) {
    return oauthError("invalid_grant", "The refresh token is invalid or expired.");
  }

  const tokens = generateOAuthTokens();
  try {
    await prisma.$transaction(async (transaction) => {
      const revoked = await transaction.mcpOAuthGrant.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: now, lastUsedAt: now },
      });
      if (revoked.count !== 1) throw new Error("refresh_token_replayed");

      await transaction.mcpOAuthGrant.create({
        data: grantRecord(
          {
            workspaceId: current.workspaceId,
            userId: current.userId,
            clientId: current.clientId,
            resource: current.resource,
            scopes: current.scopes,
          },
          tokens.accessToken,
          tokens.refreshToken,
          now
        ),
      });
    });
  } catch {
    return oauthError("invalid_grant", "The refresh token was already used.");
  }

  return tokenResponse(tokens.accessToken, tokens.refreshToken, current.scopes);
}

export async function POST(request: Request) {
  if (request.headers.get("authorization")) {
    return oauthError(
      "invalid_client",
      "This public OAuth client must use token endpoint authentication method none.",
      401
    );
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/x-www-form-urlencoded")
  ) {
    return oauthError("invalid_request", "Use application/x-www-form-urlencoded.");
  }

  const form = new URLSearchParams(await request.text());
  switch (form.get("grant_type")) {
    case "authorization_code":
      return exchangeAuthorizationCode(form);
    case "refresh_token":
      return refreshAccessToken(form);
    default:
      return oauthError("unsupported_grant_type", "Grant type is not supported.");
  }
}
