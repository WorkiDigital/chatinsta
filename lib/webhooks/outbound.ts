/**
 * Outbound lead webhooks.
 *
 * When a campaign delivers its link to someone, the campaign's webhook URL (if
 * set) receives a signed JSON POST describing the lead. Delivery never runs
 * inside the DM job: the DM job only records a WebhookDelivery row and enqueues
 * a separate `deliver-webhook` job, so a slow or broken receiver can never make
 * BullMQ retry — and therefore re-send — the DM itself.
 *
 * Signature: `X-OpenReply-Signature: sha256=<hex>` where hex is
 * HMAC-SHA256(secret, `${X-OpenReply-Timestamp}.${rawBody}`). See
 * docs/webhooks.md for the receiver side.
 */

import { createHmac, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Job } from "bullmq";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  getDMQueue,
  WEBHOOK_JOB_NAME,
  type DeliverWebhookJob,
} from "@/lib/queue/client";

export const LEAD_LINK_DELIVERED_EVENT = "lead.link_delivered";
export const WEBHOOK_TEST_EVENT = "webhook.test";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 500;

/**
 * Strip the encrypted signing secret before a campaign row leaves the API.
 * The plaintext secret is only served by the dedicated webhook route.
 */
export function omitWebhookSecret<T extends { webhookSecret?: string | null }>(
  row: T
): Omit<T, "webhookSecret"> & { hasWebhookSecret: boolean } {
  const { webhookSecret, ...rest } = row;
  return { ...rest, hasWebhookSecret: Boolean(webhookSecret) };
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function signWebhookBody(
  secret: string,
  timestamp: string,
  body: string
): string {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `sha256=${digest}`;
}

// ─── SSRF guard ────────────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, part) => (acc << 8) + Number.parseInt(part, 10), 0) >>> 0;
}

function inIpv4Range(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 3], // multicast + reserved (224.0.0.0 – 255.255.255.255)
];

/**
 * True when an IP literal points somewhere a webhook must never reach: this
 * host, the private network the app runs on, or cloud metadata endpoints.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return BLOCKED_IPV4_RANGES.some(([base, bits]) =>
      inIpv4Range(address, base, bits)
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedAddress(mapped[1]);
    // IPv4-mapped in hex form (::ffff:7f00:1).
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isBlockedAddress(
        `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
      );
    }
    const firstHextet = Number.parseInt(lower.split(":")[0] || "0", 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true; // not an IP at all — callers only pass resolved addresses
}

/**
 * Cheap, synchronous checks run when a campaign is saved: the URL must be
 * https, carry no credentials, and not name localhost or a blocked IP literal.
 * Returns an error message, or null when the URL is acceptable. DNS is checked
 * again at send time by assertWebhookUrlResolvesPublic.
 */
export function validateWebhookUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Webhook URL is not a valid URL";
  }
  if (url.protocol !== "https:") return "Webhook URL must use https://";
  if (url.username || url.password) {
    return "Webhook URL must not contain credentials";
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "Webhook URL cannot point at localhost";
  }
  if (isIP(host) && isBlockedAddress(host)) {
    return "Webhook URL cannot point at a private or internal address";
  }
  return null;
}

/**
 * Resolve the webhook host and refuse to send if ANY resolved address is
 * internal — a public-looking hostname can still resolve to 10.x or
 * 169.254.169.254.
 */
export async function assertWebhookUrlResolvesPublic(raw: string): Promise<void> {
  const syntaxError = validateWebhookUrl(raw);
  if (syntaxError) throw new Error(syntaxError);
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error("Webhook URL host did not resolve");
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error("Webhook URL resolves to a private or internal address");
    }
  }
}

// ─── Sending ───────────────────────────────────────────────────────────────────

export interface WebhookSendResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  // False for failures a retry cannot fix (4xx other than 408/429, SSRF block,
  // invalid URL), so the job gives up immediately instead of burning attempts.
  retryable: boolean;
}

export function buildWebhookBody(input: {
  deliveryId: string;
  event: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}): string {
  return JSON.stringify({
    id: input.deliveryId,
    event: input.event,
    occurredAt: input.occurredAt.toISOString(),
    ...input.payload,
  });
}

export async function sendWebhookRequest(input: {
  url: string;
  secret: string;
  event: string;
  deliveryId: string;
  body: string;
}): Promise<WebhookSendResult> {
  try {
    await assertWebhookUrlResolvesPublic(input.url);
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      error: error instanceof Error ? error.message : "Invalid webhook URL",
      retryable: false,
    };
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OpenReply-Webhook/1.0",
        "X-OpenReply-Event": input.event,
        "X-OpenReply-Delivery": input.deliveryId,
        "X-OpenReply-Timestamp": timestamp,
        "X-OpenReply-Signature": signWebhookBody(
          input.secret,
          timestamp,
          input.body
        ),
      },
      body: input.body,
      // A redirect could bounce the request to an internal address after the
      // DNS check above, so it counts as a failure instead of being followed.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      statusCode: null,
      error: timedOut
        ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : `Network error: ${error instanceof Error ? error.message : "unknown"}`,
      retryable: true,
    };
  }

  if (response.status >= 200 && response.status < 300) {
    return { ok: true, statusCode: response.status, error: null, retryable: false };
  }

  const text = await response.text().catch(() => "");
  const retryable =
    response.status >= 500 || response.status === 408 || response.status === 429;
  return {
    ok: false,
    statusCode: response.status,
    error: `HTTP ${response.status}${text ? `: ${text}` : ""}`.slice(
      0,
      MAX_ERROR_LENGTH
    ),
    retryable,
  };
}

// ─── Enqueue (called from the DM worker) ───────────────────────────────────────

export interface LeadWebhookInput {
  automation: {
    id: string;
    name: string;
    workspaceId: string;
    webhookUrl: string | null;
    instagramAccount: { instagramId: string; username: string };
  };
  contact: { instagramUserId: string; username: string | null };
  trigger: {
    source: "comment" | "button" | "dm";
    text: string | null;
    matchedKeyword: string | null;
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Record and enqueue a `lead.link_delivered` webhook. Fires at most once per
 * contact per campaign (repeat button taps and redelivered events hit the
 * unique dedupe key). Never throws: the DM this follows has already been
 * delivered, and failing the DM job here would make BullMQ send it again.
 */
export async function enqueueLeadWebhook(input: LeadWebhookInput): Promise<void> {
  const url = input.automation.webhookUrl;
  if (!url) return;

  const payload = {
    campaign: { id: input.automation.id, name: input.automation.name },
    instagramAccount: {
      id: input.automation.instagramAccount.instagramId,
      username: input.automation.instagramAccount.username,
    },
    contact: input.contact,
    trigger: input.trigger,
  };

  let deliveryId: string;
  try {
    const delivery = await prisma.webhookDelivery.create({
      data: {
        workspaceId: input.automation.workspaceId,
        automationId: input.automation.id,
        event: LEAD_LINK_DELIVERED_EVENT,
        dedupeKey: `${LEAD_LINK_DELIVERED_EVENT}:${input.contact.instagramUserId}`,
        url,
        payload: payload as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    deliveryId = delivery.id;
  } catch (error) {
    if (isUniqueViolation(error)) return; // this lead already fired
    console.error("[Webhook] Failed to record delivery:", error);
    return;
  }

  try {
    await getDMQueue().add(
      WEBHOOK_JOB_NAME,
      { deliveryId },
      { jobId: `webhook_${deliveryId}` }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await prisma.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: {
          status: "FAILED",
          errorMessage: `Could not enqueue delivery: ${message}`.slice(
            0,
            MAX_ERROR_LENGTH
          ),
        },
      })
      .catch(() => {});
  }
}

// ─── Delivery job (run by the DM worker) ───────────────────────────────────────

/**
 * Deliver one recorded webhook. A retryable failure rethrows so BullMQ
 * retries it; the final (or non-retryable) failure is recorded on the
 * WebhookDelivery row — which Diagnostics surfaces — and the job completes,
 * so a customer's broken endpoint doesn't flood the deployment-wide worker
 * alert list on every attempt.
 */
export async function processWebhookDelivery(
  job: Job<DeliverWebhookJob>
): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: job.data.deliveryId },
    include: { automation: { select: { webhookSecret: true } } },
  });
  if (!delivery || delivery.status === "SUCCESS") return;

  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? 1;

  if (!delivery.automation.webhookSecret) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        attempts: attempt,
        errorMessage: "Campaign has no webhook signing secret",
      },
    });
    return;
  }

  const result = await sendWebhookRequest({
    url: delivery.url,
    secret: decryptToken(delivery.automation.webhookSecret),
    event: delivery.event,
    deliveryId: delivery.id,
    body: buildWebhookBody({
      deliveryId: delivery.id,
      event: delivery.event,
      occurredAt: delivery.createdAt,
      payload: delivery.payload as Record<string, unknown>,
    }),
  });

  if (result.ok) {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "SUCCESS",
        attempts: attempt,
        statusCode: result.statusCode,
        errorMessage: null,
        deliveredAt: new Date(),
      },
    });
    return;
  }

  const finalAttempt = !result.retryable || attempt >= maxAttempts;
  await prisma.webhookDelivery.update({
    where: { id: delivery.id },
    data: {
      status: finalAttempt ? "FAILED" : "PENDING",
      attempts: attempt,
      statusCode: result.statusCode,
      errorMessage: result.error,
    },
  });
  if (!finalAttempt) {
    throw new Error(`Webhook delivery ${delivery.id} failed: ${result.error}`);
  }
}
