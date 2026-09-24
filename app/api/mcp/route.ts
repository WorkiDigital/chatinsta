import { createMcpHandler } from "@modelcontextprotocol/server";
import { getBaseUrl } from "@/lib/env";
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
    { error: "Provide a valid InstaMany MCP key as a Bearer token or X-API-Key header" },
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Bearer realm="InstaMany MCP"',
      },
    }
  );
}

const CLAUDE_ORIGINS = new Set([
  "https://claude.ai",
  "https://claude.com",
  "https://www.claude.ai",
  "https://www.claude.com",
]);

function originIsAllowed(origin: string): boolean {
  return origin === new URL(getBaseUrl()).origin || CLAUDE_ORIGINS.has(origin);
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin || !originIsAllowed(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id");
  headers.append("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function serve(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !originIsAllowed(origin)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }

  const auth = await authenticateMcpRequest(request);
  if (!auth) return withCors(unauthorized(), origin);

  const response = await handler.fetch(request, {
    authInfo: {
      token: auth.token,
      clientId: auth.keyId,
      scopes: ["flows:read", "flows:write"],
      extra: { workspaceId: auth.workspaceId },
    },
  });
  return withCors(response, origin);
}

export function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !originIsAllowed(origin)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-API-Key, X-OpenReply-MCP-Key, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
