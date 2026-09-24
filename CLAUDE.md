@AGENTS.md

## Claude custom connector (MCP)

The self-hosted OpenReply MCP endpoint is:

```text
https://n8n-chatinsta-web.ubufeb.easypanel.host/api/mcp
```

Configure the Claude custom connector with:

- Authentication: `No login` (`Sem login`)
- Transport: `Streamable HTTP`
- Required request header: `X-API-Key`
- Header value: a newly generated `imcp_...` key from **Settings -> MCP access**

Do not use `Authorization` in Claude because it is reserved for OAuth. Do not
use a custom header name because Anthropic requires prior approval for unknown
header names. Never commit or paste a real MCP key into this file. Revoke any
key exposed in screenshots, chat messages, logs, or command history.
