/**
 * AI reply: answers a DM that matched no campaign keyword and has no pending
 * collect-data question, using the workspace's own Anthropic key.
 *
 * Plain fetch against the Messages API, matching the rest of this codebase's
 * style for external providers (lib/zernio/client.ts, lib/meta/client.ts) —
 * no SDK dependency for one endpoint.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REPLY_TOKENS = 300;

// Fast and inexpensive — right for a DM reply. Sonnet is offered as the
// per-workspace override for accounts that want stronger judgment.
export const DEFAULT_AI_MODEL = "claude-haiku-4-5-20251001";
export const ALLOWED_AI_MODELS = [DEFAULT_AI_MODEL, "claude-sonnet-5"] as const;

export class AiReplyError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "AiReplyError";
  }
}

export interface ConversationTurn {
  inboundText: string;
  replyText: string;
}

const SYSTEM_PREAMBLE =
  "You are replying to an Instagram DM on behalf of the business below. " +
  "Keep replies short (2-4 sentences), friendly, and native to DM conversation — " +
  "no markdown, no bullet lists, no signing off with a name. " +
  "Only use the information given in your instructions; if you don't know the " +
  "answer, say so plainly and suggest they ask a person. Never invent prices, " +
  "policies, or facts not given to you.\n\nInstructions from the business:\n";

export async function generateAiReply(input: {
  apiKey: string;
  model: string | null;
  instructions: string;
  history: ConversationTurn[];
  messageText: string;
}): Promise<string> {
  const messages = [
    ...input.history.flatMap((turn) => [
      { role: "user" as const, content: turn.inboundText },
      { role: "assistant" as const, content: turn.replyText },
    ]),
    { role: "user" as const, content: input.messageText },
  ];

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: input.model || DEFAULT_AI_MODEL,
        max_tokens: MAX_REPLY_TOKENS,
        system: SYSTEM_PREAMBLE + input.instructions,
        messages,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new AiReplyError(
      timedOut
        ? `Anthropic request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : `Network error calling Anthropic: ${error instanceof Error ? error.message : "unknown"}`,
      true
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${response.status}`;
    // 401/403 (bad key) and 400 (bad request, e.g. unknown model) won't
    // recover on retry; rate limits and server errors will.
    const retryable = response.status === 429 || response.status >= 500;
    throw new AiReplyError(`Anthropic error: ${message}`, retryable);
  }

  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  const text = data.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  if (!text) {
    throw new AiReplyError("Anthropic returned an empty reply", true);
  }
  return text;
}

/**
 * A cheap, near-instant call used only to validate a key when it's saved —
 * one token of output, so it costs (and risks) almost nothing.
 */
export async function verifyAnthropicApiKey(apiKey: string): Promise<void> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: DEFAULT_AI_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  }).catch(() => {
    throw new Error("Could not reach the Anthropic API");
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${response.status}`;
    throw new Error(`Anthropic rejected this key: ${message}`);
  }
}
