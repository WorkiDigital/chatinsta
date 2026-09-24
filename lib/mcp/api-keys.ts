import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";

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
  return request.headers.get("x-openreply-mcp-key")?.trim() || null;
}

export async function authenticateMcpRequest(request: Request): Promise<{
  keyId: string;
  workspaceId: string;
  token: string;
} | null> {
  const token = readBearerToken(request);
  if (!token?.startsWith(TOKEN_PREFIX)) return null;

  const key = await prisma.mcpApiKey.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    select: { id: true, workspaceId: true, revokedAt: true },
  });
  if (!key || key.revokedAt) return null;

  await prisma.mcpApiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });

  return { keyId: key.id, workspaceId: key.workspaceId, token };
}
