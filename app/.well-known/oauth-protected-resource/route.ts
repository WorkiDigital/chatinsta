import {
  getMcpResourceUrl,
  getOAuthIssuer,
  MCP_OAUTH_SCOPES,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      resource: getMcpResourceUrl(),
      authorization_servers: [getOAuthIssuer()],
      scopes_supported: MCP_OAUTH_SCOPES,
      bearer_methods_supported: ["header"],
      resource_documentation: new URL("/docs/mcp", getOAuthIssuer()).toString(),
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}
