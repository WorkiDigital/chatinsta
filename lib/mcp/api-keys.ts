import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getMcpResourceUrl } from "@/lib/mcp/oauth";

const TOKEN_PREFIX = "imcp_";

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateMcpToken(): {
  token: string;
  tokenHash: string;
  tokenPrefix: string;
} {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashMcpToken(token),
    tokenPrefix: token.slice(0, 13),
  };
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1].trim();
  }

  // Some MCP clients reserve Authorization for OAuth and do not allow it as
  // a custom header. Accept a dedicated secret header for those clients.
  return (
    request.headers.get("x-api-key")?.trim() ||
    request.headers.get("x-openreply-mcp-key")?.trim() ||
    null
  );
}

export async function authenticateMcpRequest(request: Request): Promise<{
  keyId: string;
  workspaceId: string;
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  resource?: string;
} | null> {
  const token = readBearerToken(request);
  if (!token) return null;

  if (token.startsWith("imcpo_")) {
    const grant = await prisma.mcpOAuthGrant.findUnique({
      where: { accessTokenHash: hashMcpToken(token) },
      select: {
        id: true,
        workspaceId: true,
        clientId: true,
        scopes: true,
        resource: true,
        accessTokenExpiresAt: true,
        revokedAt: true,
      },
    });
    if (
      !grant ||
      grant.revokedAt ||
      grant.accessTokenExpiresAt <= new Date() ||
      grant.resource !== getMcpResourceUrl()
    ) {
      return null;
    }

    await prisma.mcpOAuthGrant.update({
      where: { id: grant.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      keyId: grant.id,
      workspaceId: grant.workspaceId,
      token,
      clientId: grant.clientId,
      scopes: grant.scopes,
      expiresAt: Math.floor(grant.accessTokenExpiresAt.getTime() / 1000),
      resource: grant.resource,
    };
  }

  if (!token.startsWith(TOKEN_PREFIX)) return null;

  const key = await prisma.mcpApiKey.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    select: { id: true, workspaceId: true, revokedAt: true },
  });
  if (!key || key.revokedAt) return null;

  await prisma.mcpApiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    keyId: key.id,
    workspaceId: key.workspaceId,
    token,
    clientId: key.id,
    scopes: ["flows:read", "flows:write"],
  };
}
