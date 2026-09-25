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

## ChatGPT custom connector (MCP)

Unlike Claude, ChatGPT's "Criar aplicativo MCP" dialog only offers `OAuth` or
`API key`/no-login modes it discovers itself — it does not let you name a
custom header, so the `X-API-Key` flow above does not work here. Instead, the
server has a real OAuth 2.0 authorization-code + PKCE flow built
specifically for ChatGPT's connector client (`lib/mcp/oauth.ts`,
`app/.well-known/oauth-authorization-server`,
`app/.well-known/oauth-protected-resource`, `app/oauth/authorize`,
`app/oauth/token`). To connect:

- Conexão / URL do servidor: same endpoint as above,
  `https://n8n-chatinsta-web.ubufeb.easypanel.host/api/mcp`
- Autenticação: `OAuth`
- No header name/value to fill in — ChatGPT does the OAuth handshake itself
  and signs you into your OpenReply workspace during the flow.

This only works for ChatGPT's own client — `getAllowedChatGptRedirectUri` in
`lib/mcp/oauth.ts` hardcodes the accepted `client_id`/`redirect_uri` pairs
(`https://chatgpt.com/oauth/client.json` and
`https://chatgpt.com/oauth/<id>/client.json`); any other OAuth client is
rejected with `invalid_request`.

**"A configuração de OAuth está indisponível para este servidor"** — ChatGPT
couldn't fetch `/.well-known/oauth-protected-resource` or
`/.well-known/oauth-authorization-server` from the endpoint above. This
almost always means the deployed instance predates this OAuth support (added
in commit `653aa35`, which also shipped the `20260925120000_mcp_oauth`
migration for `McpOAuthAuthorizationCode`/`McpOAuthGrant`) — **redeploy the
web service** (the normal deploy runs `prisma migrate deploy` first, so the
new tables come along automatically) and try creating the connector again.
If it still fails after a fresh deploy, check that `NEXTAUTH_URL` on the
deployment is the exact public HTTPS URL above — `getOAuthIssuer()`/
`getBaseUrl()` derive every OAuth endpoint from it, so a wrong or missing
value breaks discovery the same way.
