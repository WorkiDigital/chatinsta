# AI replies

A campaign can answer questions in DM that its own keywords don't catch,
using Claude.

## Set up

1. **Settings → AI replies**: paste an [Anthropic API
   key](https://console.anthropic.com/settings/keys). It's verified with a
   1-token request before saving, then stored encrypted — the same way the
   Zernio and webhook secrets are. Pick a model: **Haiku** (fast, cheap,
   the default) or **Sonnet** (stronger judgment, costs more).
2. In the campaign editor, under **And answer questions with**, turn on **AI,
   when nothing else matches** and write instructions: who you are, what you
   sell, how to sound, and anything Claude should never guess at (price,
   policy, availability).

There's one Anthropic key per workspace, shared by every campaign that turns
this on.

## When it replies

Every inbound DM is checked in this order:

1. A pending [collect-data](webhooks.md) question — a typed answer to that
   always wins.
2. The campaign's own trigger keywords (`dmTriggerEnabled`).
3. **Only if neither of those matched**, and some active campaign on that
   Instagram account has AI replies on: Claude answers, using your
   instructions as its system prompt plus the last few turns of that
   person's AI conversation for context.

It never replies to a message a keyword already handled, and never touches
the reveal flow (opening DM, follow gate, the link, collect-data, the
follow-up, or the lead webhook) — those still run exactly as configured.

## Limits

- **Per contact**: `aiReplyMaxPerContact` (default 5, editable per campaign)
  — after that, unmatched messages from that person go unanswered rather
  than spending more of your Anthropic quota indefinitely.
- **Per account**: the same hourly Instagram send limit every other DM
  already shares. A reply is simply skipped, not queued, if the account is
  at its cap right now.
- Each reply is capped at 300 tokens and written to sound like a DM — short,
  no markdown, no lists.

## What it can't do

It only knows what you put in its instructions. It's told explicitly not to
invent prices, policies or facts, and to say so plainly when it doesn't know
something — but review its replies periodically, the same as you would any
automated message.

## Where replies show up

The campaign editor doesn't list AI replies directly; they're ordinary DMs
and appear in the same conversation as everything else. Diagnostics and
worker alerts still cover genuine failures (an invalid or revoked API key,
Anthropic being unreachable) — those stop the job without retrying pointlessly.
