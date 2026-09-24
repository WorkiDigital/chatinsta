# InstaMany MCP server

InstaMany exposes a remote Model Context Protocol endpoint at:

```text
https://YOUR_DOMAIN/api/mcp
```

The endpoint uses Streamable HTTP and accepts both the current MCP protocol and
the stateless 2025 protocol used by older clients.

## Create access

1. Sign in to InstaMany as a workspace owner or admin.
2. Open **Settings** and find **MCP access**.
3. Create a named key for the client you plan to connect.
4. Copy the key immediately. InstaMany stores only its SHA-256 hash and cannot
   show the complete key again.
5. Configure the MCP client with the endpoint above and this HTTP header:

```text
Authorization: Bearer imcp_YOUR_KEY
```

Clients that reserve the `Authorization` header for OAuth, such as Claude
custom connectors, can send the raw key in this header instead:

```text
X-OpenReply-MCP-Key: imcp_YOUR_KEY
```

Each key is bound to the workspace that created it. It cannot read or modify a
different workspace. Revoke a key from Settings to remove its access
immediately.

## Available tools

| Tool | Purpose |
| --- | --- |
| `list_instagram_accounts` | List connected Instagram accounts and their IDs. |
| `list_flows` | List flows, optionally filtered by account or active status. |
| `get_flow` | Read the complete configuration of one flow. |
| `create_flow` | Create a flow for any post, the next reel, or one specific post. |
| `update_flow` | Change keywords, messages, public replies, and the primary tracked link. |
| `set_flow_status` | Activate or pause a flow. |

For safety, `create_flow` creates an inactive flow unless the caller explicitly
sets `isActive` to `true`. The MCP does not expose flow deletion.

## Client configuration

Use a remote/Streamable HTTP MCP connection with:

```json
{
  "url": "https://YOUR_DOMAIN/api/mcp",
  "headers": {
    "Authorization": "Bearer imcp_YOUR_KEY"
  }
}
```

The exact outer configuration object depends on the MCP client. Keep the key in
the client's secret storage or an environment variable; do not commit it to the
repository.

## Deployment

The normal Docker Compose deployment runs `prisma migrate deploy` before the web
server starts. After deploying this version, the `McpApiKey` table is therefore
created automatically. No new EasyPanel environment variable is required.
