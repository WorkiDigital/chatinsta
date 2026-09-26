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
custom connectors, can send the raw key in the standard API-key header instead:

```text
X-API-Key: imcp_YOUR_KEY
```

Each key is bound to the workspace that created it. It cannot read or modify a
different workspace. Revoke a key from Settings to remove its access
immediately.

## Connect ChatGPT

ChatGPT uses OAuth 2.1 instead of a fixed API-key header. In ChatGPT developer
mode, create an MCP app with:

- **Name:** `OpenReply Instagram`
- **Server URL:** `https://YOUR_DOMAIN/api/mcp`
- **Authentication:** `OAuth`

Do not paste an `imcp_...` key into the ChatGPT form. ChatGPT discovers the
OAuth endpoints automatically, redirects the user to the OpenReply login and
consent screen, and then uses short-lived access tokens with rotating refresh
tokens.

Only a workspace owner or admin can approve the connection. The OAuth grant is
bound to that workspace and carries `flows:read` and `flows:write` scopes.
The existing API-key flow remains available for Claude and other MCP clients
that support custom request headers.

The deployment must use HTTPS and `NEXTAUTH_URL` must be the exact public
origin, for example:

```text
NEXTAUTH_URL=https://openreply.example
```

After deploying a version that adds OAuth, run the normal Prisma migrations
before creating the app in ChatGPT.

## Available tools

| Tool | Purpose |
| --- | --- |
| `list_instagram_accounts` | List connected Instagram accounts and their IDs. |
| `list_flows` | List flows, optionally filtered by account or active status. |
| `get_flow` | Read the complete configuration of one flow. |
| `create_flow` | Create a flow for any post, the next reel, or one specific post. |
| `update_flow` | Change keywords, messages, public replies, and the primary tracked link. |
| `set_flow_status` | Activate or pause a flow. |
| `list_conversations` | List DM conversations for one Instagram account. |
| `get_conversation` | Read one conversation's message history. |
| `send_message` | Reply in an existing conversation. |
| `get_diagnostics` | Read the same data as the dashboard's Production Diagnostics page. |

For safety, `create_flow` creates an inactive flow unless the caller explicitly
sets `isActive` to `true`. The MCP does not expose flow deletion, and it does
not expose conversation deletion either.

Every tool resolves its Instagram account through the same workspace-scoped
lookup the dashboard uses (`getWorkspaceInstagramAccount`), and every read or
write is filtered by the workspace tied to the calling API key — the same
authentication and workspace boundary as the rest of InstaMany's API.

### Opening DM, follow gate, and follow-up

`create_flow` and `update_flow` also accept the fields that control the rest of
the DM sequence:

- `openingDmEnabled`, `openingDmMessage`, `openingDmButtonLabel` — send an
  opening DM before the link. `openingDmMessage` and `openingDmButtonLabel` are
  required together when `openingDmEnabled` is `true`; this is what makes the
  link render as a tappable button instead of plain text in the DM.
- `requireFollow`, `followPromptMessage`, `followPromptButtonLabel` — gate the
  link behind a follow check, prompting the user to follow before it unlocks.
- `followUpEnabled`, `followUpMessage`, `followUpDelayMinutes` — send a
  follow-up DM after the link is delivered, delayed by `followUpDelayMinutes`
  (0-1440 minutes).
- `webhookUrl` — an `https://` URL that receives a signed `lead.link_delivered`
  POST for each new lead (see [webhooks.md](webhooks.md)). Pass `""` or `null`
  on `update_flow` to stop. The signing secret is never returned over MCP;
  copy it from the campaign editor.
- `collectDataEnabled`, `collectDataQuestion`, `collectDataFieldType`
  (`EMAIL` | `PHONE` | `TEXT`, default `TEXT`), `collectDataInvalidMessage` —
  ask a question in DM and hold the link until the reply validates for the
  chosen field type (retried up to 5 times), instead of sending the link
  right away. Sits after the opening DM / follow gate and before the link, so
  it applies to every path that would otherwise reveal the link: a direct
  comment reply, a button tap, or a DM keyword trigger. The collected answer
  is attached to the `lead.link_delivered` webhook payload as
  `collectedAnswer`.
- `aiReplyEnabled`, `aiReplyInstructions`, `aiReplyMaxPerContact` (default 5)
  — have Claude answer a DM that matches no keyword and has no pending
  collect-data question, using `aiReplyInstructions` as its brief and the
  workspace's own Anthropic key (set in Settings — the MCP never handles
  that key). Capped per contact by `aiReplyMaxPerContact`.

Setting any of the three `*Enabled`/`requireFollow` flags to `false` on
`update_flow` clears that section's stored messages.

### Chat tools

`list_conversations`, `get_conversation`, and `send_message` read and write
through the exact same Conversations API the dashboard **Inbox** page uses
(`lib/instagram/provider.ts`), so a reply sent via MCP shows up in the Inbox
like any other message, and vice versa. A few fields are best-effort given
what that API actually exposes:

- **`windowOpen`** (`list_conversations`) is `true`/`false` only when the most
  recent message in the list is inbound; Meta's list endpoint doesn't return
  enough history to tell otherwise, so it comes back `null` in that case. Call
  `get_conversation` or attempt `send_message` for a definitive answer.
- **`unreadOnly`** (`list_conversations`) is a heuristic — the last message
  came from the contact and hasn't been replied to yet — since Instagram
  exposes no native unread flag through this API.
- **`flowId`** (`list_conversations`) and **`origin`** (`get_conversation`) are
  derived from `DmLog`, matching a contact's automation sends by timestamp;
  there is no direct link from a Conversations API message to the automation
  that sent it.
- `get_conversation`'s `limit`/`cursor` page within the ~20 most recent
  messages Instagram returns for a thread; they cannot reach further history.

`send_message` re-checks the 24-hour messaging window itself before sending
(using the same message-history call as `get_conversation`) and returns a
plain "Janela de 24h fechada, o Instagram não permite enviar" error instead of
calling the send API when it's closed. It is also rate-limited to 30 sends per
minute per Instagram account, independent of the automation DM rate limit, to
stop a runaway client from mass-messaging through the account.

### Diagnostics

`get_diagnostics` calls the exact same aggregation (`lib/ops/get-diagnostics.ts`)
as the dashboard's **Production Diagnostics** page and the `/api/admin/diagnostics`
route it reads from — same data, same shape. Two things to know about its scope:

- `queueCounts`, `workerHealth`, and `workerAlerts` describe the DM worker
  process and its BullMQ queue, which are **shared infrastructure for the
  whole deployment** — every workspace hosted on this instance sees the same
  numbers and alerts, not just the caller's. This mirrors the dashboard page
  exactly; it is not a boundary the MCP loosens.
- `webhookFailures`, `dmFailures`, `tokenRefreshFailures`, and the
  workspace-scoped rows in `operationalEvents` are filtered to the calling
  API key's workspace, same as everywhere else in the MCP.

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
server starts. The MCP API-key and OAuth tables are therefore created
automatically. No new EasyPanel environment variable is required.
