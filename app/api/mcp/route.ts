import { createMcpHandler } from "@modelcontextprotocol/server";
import { authenticateMcpRequest } from "@/lib/mcp/api-keys";
import { createInstaManyMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = createMcpHandler(
  ({ authInfo }) => {
    const workspaceId = authInfo?.extra?.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new Error("Missing authenticated MCP workspace");
    }
    return createInstaManyMcpServer(workspaceId);
  },
  {
    responseMode: "auto",
    legacy: "stateless",
    maxRequestBodySize: 1024 * 1024,
    onerror: (error) => console.error("MCP request failed", error),
  }
);

function unauthorized() {
  return Response.json(
    { error: "Provide a valid InstaMany MCP key as a Bearer token or X-OpenReply-MCP-Key header" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Bearer realm="InstaMany MCP"',
      },
    }
  );
}

async function serve(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const auth = await authenticateMcpRequest(request);
  if (!auth) return unauthorized();

  return handler.fetch(request, {
    authInfo: {
      token: auth.token,
      clientId: auth.keyId,
      scopes: ["flows:read", "flows:write"],
      extra: { workspaceId: auth.workspaceId },
    },
  });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
