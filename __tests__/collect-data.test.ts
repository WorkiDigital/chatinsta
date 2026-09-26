import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    contactAnswer: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
      update: mocks.update,
    },
  },
}));

import {
  MAX_INVALID_ATTEMPTS,
  needsCollection,
  startCollection,
  tryAnswerPendingQuestion,
  validateAnswer,
} from "@/lib/collect-data";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateAnswer", () => {
  it.each([
    ["EMAIL", "ana@example.com", "ana@example.com"],
    ["EMAIL", "not an email", null],
    ["EMAIL", "  ana@example.com  ", "ana@example.com"],
    ["PHONE", "+1 415-555-0100", "+1 415-555-0100"],
    ["PHONE", "call me", null],
    ["PHONE", "12345", null], // fewer than 8 digits
    ["TEXT", "  anything goes  ", "anything goes"],
    ["TEXT", "   ", null],
  ] as const)("%s / %s -> %s", (fieldType, input, expected) => {
    expect(validateAnswer(fieldType, input)).toBe(expected);
  });
});

describe("needsCollection", () => {
  it("is false when the campaign doesn't collect data", async () => {
    expect(
      await needsCollection({ id: "auto_1", collectDataEnabled: false }, "u1")
    ).toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("is true when no answer exists yet", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(
      await needsCollection({ id: "auto_1", collectDataEnabled: true }, "u1")
    ).toBe(true);
  });

  it("is false once answered", async () => {
    mocks.findUnique.mockResolvedValue({ status: "ANSWERED" });
    expect(
      await needsCollection({ id: "auto_1", collectDataEnabled: true }, "u1")
    ).toBe(false);
  });

  it("is true again for an expired, never-answered question", async () => {
    mocks.findUnique.mockResolvedValue({ status: "EXPIRED" });
    expect(
      await needsCollection({ id: "auto_1", collectDataEnabled: true }, "u1")
    ).toBe(true);
  });
});

describe("startCollection", () => {
  it("upserts a fresh PENDING row with a 24h window", async () => {
    mocks.upsert.mockResolvedValue({});
    await startCollection({
      workspaceId: "ws_1",
      automationId: "auto_1",
      instagramUserId: "u1",
      commenterName: "ana",
      question: "What's your email?",
      fieldType: "EMAIL",
      trigger: { source: "comment", text: "GUIDE", matchedKeyword: "guide" },
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { automationId_instagramUserId: { automationId: "auto_1", instagramUserId: "u1" } },
        create: expect.objectContaining({ question: "What's your email?", fieldType: "EMAIL" }),
        update: expect.objectContaining({ status: "PENDING", answer: null, attempts: 0 }),
      })
    );
  });
});

describe("tryAnswerPendingQuestion", () => {
  const pendingRow = {
    id: "ca_1",
    fieldType: "EMAIL" as const,
    attempts: 0,
    commenterName: "ana",
    triggerSource: "comment",
    triggerText: "GUIDE",
    matchedKeyword: "guide",
    automation: {
      id: "auto_1",
      collectDataInvalidMessage: null,
      instagramAccount: { instagramId: "ig_1" },
    },
  };

  it("returns not_pending when nothing is waiting", async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await tryAnswerPendingQuestion("ig_1", "u1", "hi")).toEqual({
      kind: "not_pending",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("marks ANSWERED on a valid reply", async () => {
    mocks.findFirst.mockResolvedValue(pendingRow);
    mocks.update.mockResolvedValue({ status: "ANSWERED", answer: "ana@example.com" });
    const outcome = await tryAnswerPendingQuestion("ig_1", "u1", "ana@example.com");
    expect(outcome.kind).toBe("answered");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "ANSWERED", answer: "ana@example.com" },
      })
    );
  });

  it("re-prompts and bumps attempts on an invalid reply", async () => {
    mocks.findFirst.mockResolvedValue(pendingRow);
    mocks.update.mockResolvedValue({});
    const outcome = await tryAnswerPendingQuestion("ig_1", "u1", "nope");
    expect(outcome).toMatchObject({ kind: "invalid", attemptsRemaining: MAX_INVALID_ATTEMPTS - 1 });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { attempts: 1 } })
    );
  });

  it("uses the campaign's custom invalid message when set", async () => {
    mocks.findFirst.mockResolvedValue({
      ...pendingRow,
      automation: { ...pendingRow.automation, collectDataInvalidMessage: "Try again please!" },
    });
    mocks.update.mockResolvedValue({});
    const outcome = await tryAnswerPendingQuestion("ig_1", "u1", "nope");
    expect(outcome).toMatchObject({ kind: "invalid", message: "Try again please!" });
  });

  it("gives up after the max invalid attempts", async () => {
    mocks.findFirst.mockResolvedValue({ ...pendingRow, attempts: MAX_INVALID_ATTEMPTS - 1 });
    mocks.update.mockResolvedValue({ status: "EXPIRED" });
    const outcome = await tryAnswerPendingQuestion("ig_1", "u1", "still nope");
    expect(outcome.kind).toBe("gave_up");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "EXPIRED", attempts: MAX_INVALID_ATTEMPTS } })
    );
  });
});
