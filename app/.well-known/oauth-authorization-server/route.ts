import { getOAuthIssuer, MCP_OAUTH_SCOPES } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export function GET() {
  const issuer = getOAuthIssuer();
  return Response.json(
    {
      issuer,
      authorization_endpoint: new URL("/oauth/authorize", issuer).toString(),
      token_endpoint: new URL("/oauth/token", issuer).toString(),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      scopes_supported: MCP_OAUTH_SCOPES,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    }
  );
}
