import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    webhookDelivery: {
      create: mocks.create,
      update: mocks.update,
      findUnique: mocks.findUnique,
    },
  },
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: mocks.queueAdd }),
  WEBHOOK_JOB_NAME: "deliver-webhook",
}));
vi.mock("@/lib/meta/oauth", () => ({
  decryptToken: (value: string) => `plain:${value}`,
}));

import {
  enqueueLeadWebhook,
  isBlockedAddress,
  processWebhookDelivery,
  sendWebhookRequest,
  signWebhookBody,
  validateWebhookUrl,
} from "@/lib/webhooks/outbound";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("signing", () => {
  it("signs timestamp.body with HMAC-SHA256 so receivers can verify it", () => {
    const expected = createHmac("sha256", "secret")
      .update("1700000000.{\"a\":1}")
      .digest("hex");
    expect(signWebhookBody("secret", "1700000000", "{\"a\":1}")).toBe(
      `sha256=${expected}`
    );
  });
});

describe("SSRF guard", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
  ])("blocks internal address %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );

  it.each([
    ["http://example.com/hook", "https"],
    ["https://localhost/hook", "localhost"],
    ["https://user:pass@example.com/hook", "credentials"],
    ["https://10.0.0.5/hook", "private"],
    ["not a url", "valid"],
  ])("rejects %s at save time", (url, fragment) => {
    expect(validateWebhookUrl(url)).toMatch(new RegExp(fragment, "i"));
  });

  it("accepts a public https URL", () => {
    expect(validateWebhookUrl("https://hooks.example.com/lead")).toBeNull();
  });

  it("refuses to send when a public-looking host resolves internally", async () => {
    mocks.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const result = await sendWebhookRequest({
      url: "https://evil.example.com/hook",
      secret: "s",
      event: "e",
      deliveryId: "d",
      body: "{}",
    });
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendWebhookRequest", () => {
  const input = {
    url: "https://hooks.example.com/lead",
    secret: "secret",
    event: "lead.link_delivered",
    deliveryId: "delivery_1",
    body: "{\"ok\":true}",
  };

  it("posts the signed body without following redirects", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await sendWebhookRequest(input);
    expect(result).toEqual({ ok: true, statusCode: 200, error: null, retryable: false });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.redirect).toBe("manual");
    expect(init.headers["X-OpenReply-Delivery"]).toBe("delivery_1");
    expect(init.headers["X-OpenReply-Signature"]).toBe(
      signWebhookBody("secret", init.headers["X-OpenReply-Timestamp"], input.body)
    );
  });

  it("treats a 4xx as permanent", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 400 }));
    expect(await sendWebhookRequest(input)).toMatchObject({
      ok: false,
      statusCode: 400,
      retryable: false,
    });
  });

  it("retries 5xx, 408 and 429", async () => {
    for (const status of [500, 503, 408, 429]) {
      fetchMock.mockResolvedValueOnce(new Response("", { status }));
      expect(await sendWebhookRequest(input)).toMatchObject({ ok: false, retryable: true });
    }
  });

  it("does not count a redirect as delivered", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 302 }));
    expect(await sendWebhookRequest(input)).toMatchObject({ ok: false, statusCode: 302 });
  });

  it("retries network errors", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await sendWebhookRequest(input)).toMatchObject({ ok: false, retryable: true });
  });
});

describe("processWebhookDelivery", () => {
  const delivery = {
    id: "delivery_1",
    status: "PENDING",
    url: "https://hooks.example.com/lead",
    event: "lead.link_delivered",
    createdAt: new Date("2026-09-26T12:00:00Z"),
    payload: { contact: { instagramUserId: "u1", username: "ana" } },
    automation: { webhookSecret: "encrypted" },
  };
  const job = (attemptsMade: number) =>
    ({ data: { deliveryId: "delivery_1" }, attemptsMade, opts: { attempts: 3 } }) as never;

  it("marks a 2xx as SUCCESS", async () => {
    mocks.findUnique.mockResolvedValue(delivery);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await processWebhookDelivery(job(0));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCESS", attempts: 1, statusCode: 204 }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ id: "delivery_1", event: "lead.link_delivered", contact: { username: "ana" } });
  });

  it("rethrows a retryable failure while attempts remain", async () => {
    mocks.findUnique.mockResolvedValue(delivery);
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await expect(processWebhookDelivery(job(0))).rejects.toThrow();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
    );
  });

  it("records FAILED and completes on the final attempt", async () => {
    mocks.findUnique.mockResolvedValue(delivery);
    fetchMock.mockResolvedValue(new Response("", { status: 503 }));
    await expect(processWebhookDelivery(job(2))).resolves.toBeUndefined();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", attempts: 3 }) })
    );
  });

  it("gives up immediately on a permanent failure", async () => {
    mocks.findUnique.mockResolvedValue(delivery);
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    await expect(processWebhookDelivery(job(0))).resolves.toBeUndefined();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("skips a delivery that already succeeded", async () => {
    mocks.findUnique.mockResolvedValue({ ...delivery, status: "SUCCESS" });
    await processWebhookDelivery(job(0));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("enqueueLeadWebhook", () => {
  const base = {
    automation: {
      id: "auto_1",
      name: "Guide",
      workspaceId: "ws_1",
      webhookUrl: "https://hooks.example.com/lead",
      instagramAccount: { instagramId: "ig_1", username: "brand" },
    },
    contact: { instagramUserId: "u1", username: "ana" },
    trigger: { source: "comment" as const, text: "GUIDE", matchedKeyword: "guide" },
  };

  it("does nothing when the campaign has no webhook", async () => {
    await enqueueLeadWebhook({ ...base, automation: { ...base.automation, webhookUrl: null } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("records one delivery per contact and enqueues it", async () => {
    mocks.create.mockResolvedValue({ id: "delivery_1" });
    await enqueueLeadWebhook(base);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ dedupeKey: "lead.link_delivered:u1" }),
      })
    );
    expect(mocks.queueAdd).toHaveBeenCalledWith(
      "deliver-webhook",
      { deliveryId: "delivery_1" },
      { jobId: "webhook_delivery_1" }
    );
  });

  it("swallows a duplicate lead without enqueueing again", async () => {
    mocks.create.mockRejectedValue({ code: "P2002" });
    await expect(enqueueLeadWebhook(base)).resolves.toBeUndefined();
    expect(mocks.queueAdd).not.toHaveBeenCalled();
  });

  it("never throws into the DM job, even if recording fails", async () => {
    mocks.create.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(enqueueLeadWebhook(base)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
