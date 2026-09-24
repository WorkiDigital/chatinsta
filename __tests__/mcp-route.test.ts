import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    mcpApiKey: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

import { POST } from "@/app/api/mcp/route";

function mcpRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://instamany.example/api/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      Authorization: "Bearer imcp_valid",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("MCP HTTP endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: "key_1",
      workspaceId: "workspace_1",
      revokedAt: null,
    });
    mocks.update.mockResolvedValue({});
  });

  it("requires a workspace MCP Bearer key", async () => {
    const response = await POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { Authorization: "Bearer invalid" }
      )
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects cross-origin browser requests", async () => {
    const response = await POST(
      mcpRequest(
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        { Origin: "https://attacker.example" }
      )
    );
    expect(response.status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("serves the MCP initialize handshake", async () => {
    const response = await POST(
      mcpRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("instamany-flows");
  });

  it("advertises the flow management tools", async () => {
    const response = await POST(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("list_flows");
    expect(body).toContain("create_flow");
    expect(body).toContain("update_flow");
    expect(body).toContain("set_flow_status");
    expect(body).toContain("list_conversations");
    expect(body).toContain("get_conversation");
    expect(body).toContain("send_message");
  });
});
