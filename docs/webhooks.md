# Lead webhooks

A campaign can POST every new lead to a URL you choose: your CRM, n8n, Make,
Zapier, or your own backend. Turn it on in the campaign editor under **And send
the lead to → a webhook**, or pass `webhookUrl` to the MCP `create_flow` /
`update_flow` tools.

## When it fires

Event `lead.link_delivered` fires when the campaign actually delivers its link
to someone:

- straight from the comment, when there is no opening DM or follow gate
- after they tap the opening DM or follow-gate button
- after a DM keyword trigger

It fires **once per person per campaign**. Repeat button taps, redelivered
Instagram events and later comments by the same person don't fire it again.

## Request

`POST` with `Content-Type: application/json`, a 10-second timeout, and no
redirects followed.

| Header | Value |
| --- | --- |
| `X-OpenReply-Event` | `lead.link_delivered` (or `webhook.test` from the Send test button) |
| `X-OpenReply-Delivery` | Unique id for this lead. It is the same on every retry, so use it to dedupe. |
| `X-OpenReply-Timestamp` | Unix seconds when this attempt was signed |
| `X-OpenReply-Signature` | `sha256=` + hex HMAC-SHA256 of `{timestamp}.{raw body}` |

Body:

```json
{
  "id": "cm1…",
  "event": "lead.link_delivered",
  "occurredAt": "2026-09-26T12:00:00.000Z",
  "campaign": { "id": "cm0…", "name": "Free guide" },
  "instagramAccount": { "id": "17841…", "username": "yourbrand" },
  "contact": { "instagramUserId": "9876…", "username": "ana" },
  "trigger": { "source": "comment", "text": "GUIDE please", "matchedKeyword": "guide" }
}
```

`trigger.source` is `comment`, `button` or `dm`. `contact.username` can be
`null`, because Instagram only sends the username on comment events.

## Verifying the signature

Copy the campaign's **Signing secret** from the editor. Check the signature
against the **raw** body before parsing it. Also reject old timestamps, so a
captured request can't be replayed. Node.js example:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function isValid(rawBody, headers, secret) {
  const timestamp = headers["x-openreply-timestamp"];
  const received = headers["x-openreply-signature"] ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected =
    "sha256=" +
    createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return (
    received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  );
}
```

**Generate new secret** takes effect right away, so update your receiver when
you rotate it.

## Retries and failures

Any 2xx response counts as delivered.

| Response | What happens |
| --- | --- |
| 5xx, 408, 429, timeout, network error | Retried after 30 s, then 2 min, for up to 3 attempts in total |
| Any other 4xx, or a redirect | Not retried, because retrying can't fix it |

The campaign editor lists the 20 most recent deliveries. Failures also appear
under **Diagnostics → Lead Webhook Failures**.

## Restrictions

Only `https://` URLs are accepted. The following are refused:

- URLs that contain credentials
- `localhost`
- any host that resolves to a private, loopback, link-local or cloud-metadata
  address

The host is checked when you save and again before every delivery.
