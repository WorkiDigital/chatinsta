import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  oauthFindUnique: vi.fn(),
  oauthUpdate: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    mcpApiKey: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    mcpOAuthGrant: {
      findUnique: mocks.oauthFindUnique,
      update: mocks.oauthUpdate,
    },
  },
}));

import {
  authenticateMcpRequest,
  generateMcpToken,
  hashMcpToken,
  readBearerToken,
} from "@/lib/mcp/api-keys";

describe("MCP API keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates opaque keys and stores only a deterministic hash", () => {
    const first = generateMcpToken();
    const second = generateMcpToken();

    expect(first.token).toMatch(/^imcp_[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashMcpToken(first.token));
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenPrefix).toBe(first.token.slice(0, 13));
  });

  it("reads Bearer authorization and the Claude-compatible custom header", () => {
    expect(readBearerToken(new Request("https://example.com/api/mcp"))).toBeNull();
    expect(
      readBearerToken(
        new Request("https://example.com/api/mcp", {
          headers: { Authorization: "Basic abc" },
        })
      )
    ).toBeNull();
    expect(
      readBearerToken(
        new Request("https://example.com/api/mcp", {
          headers: { Authorization: "Bearer imcp_secret" },
        })
      )
    ).toBe("imcp_secret");
    expect(
      readBearerToken(
        new Request("https://example.com/api/mcp", {
          headers: { "X-OpenReply-MCP-Key": "imcp_custom" },
        })
      )
    ).toBe("imcp_custom");
    expect(
      readBearerToken(
        new Request("https://example.com/api/mcp", {
          headers: { "X-API-Key": "imcp_standard" },
        })
      )
    ).toBe("imcp_standard");
  });

  it("rejects revoked keys", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "key_1",
      workspaceId: "workspace_1",
      revokedAt: new Date(),
    });

    const request = new Request("https://example.com/api/mcp", {
      headers: { Authorization: "Bearer imcp_revoked" },
    });
    await expect(authenticateMcpRequest(request)).resolves.toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("authenticates an active key in exactly one workspace", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "key_1",
      workspaceId: "workspace_1",
      revokedAt: null,
    });
    mocks.update.mockResolvedValue({});

    const request = new Request("https://example.com/api/mcp", {
      headers: { Authorization: "Bearer imcp_active" },
    });
    await expect(authenticateMcpRequest(request)).resolves.toEqual({
      keyId: "key_1",
      workspaceId: "workspace_1",
      token: "imcp_active",
      clientId: "key_1",
      scopes: ["flows:read", "flows:write"],
    });
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashMcpToken("imcp_active") },
      select: { id: true, workspaceId: true, revokedAt: true },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "key_1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("authenticates an active ChatGPT OAuth access token", async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.oauthFindUnique.mockResolvedValue({
      id: "grant_1",
      workspaceId: "workspace_1",
      clientId: "https://chatgpt.com/oauth/client.json",
      scopes: ["flows:read", "flows:write", "offline_access"],
      resource: "http://localhost:3000/api/mcp",
      accessTokenExpiresAt: expiresAt,
      revokedAt: null,
    });
    mocks.oauthUpdate.mockResolvedValue({});

    const request = new Request("https://example.com/api/mcp", {
      headers: { Authorization: "Bearer imcpo_active" },
    });
    await expect(authenticateMcpRequest(request)).resolves.toEqual({
      keyId: "grant_1",
      workspaceId: "workspace_1",
      token: "imcpo_active",
      clientId: "https://chatgpt.com/oauth/client.json",
      scopes: ["flows:read", "flows:write", "offline_access"],
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      resource: "http://localhost:3000/api/mcp",
    });
    expect(mocks.oauthUpdate).toHaveBeenCalledWith({
      where: { id: "grant_1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });
});
