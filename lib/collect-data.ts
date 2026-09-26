/**
 * Collect-data: ask a question in DM before releasing the campaign's link,
 * and remember the answer.
 *
 * The flow has no other memory of "where a contact is" — every other step is
 * stateless, driven entirely by a button's payload string. This is the one
 * place that needs real state, because the next input is free-typed text
 * with no payload to route on. ContactAnswer is that state, one row per
 * (automation, Instagram user), looked up in processMessage BEFORE keyword
 * matching so a typed answer isn't dropped as an unrecognized message.
 */

import type { CollectDataFieldType, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";

export const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000; // matches Instagram's messaging window
export const MAX_INVALID_ATTEMPTS = 5;

export const DEFAULT_INVALID_MESSAGE: Record<CollectDataFieldType, string> = {
  EMAIL: "That doesn't look like an email — mind trying again?",
  PHONE: "That doesn't look like a phone number — mind trying again?",
  TEXT: "Sorry, I didn't catch that — mind trying again?",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts common separators (space, dash, dot, parens) and an optional
// leading +; requires at least 8 digits so "call me" doesn't pass.
const PHONE_RE = /^\+?[\d\s().-]{8,20}$/;
const PHONE_DIGIT_COUNT = /\d/g;

export function validateAnswer(
  fieldType: CollectDataFieldType,
  raw: string
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (fieldType === "EMAIL") return EMAIL_RE.test(trimmed) ? trimmed : null;
  if (fieldType === "PHONE") {
    if (!PHONE_RE.test(trimmed)) return null;
    const digits = trimmed.match(PHONE_DIGIT_COUNT)?.length ?? 0;
    return digits >= 8 ? trimmed : null;
  }
  return trimmed.slice(0, 500);
}

export interface StartCollectionInput {
  workspaceId: string;
  automationId: string;
  instagramUserId: string;
  commenterName: string | null;
  question: string;
  fieldType: CollectDataFieldType;
  trigger: {
    source: string;
    text: string | null;
    matchedKeyword: string | null;
  };
}

/**
 * Record that a campaign is now waiting on this contact's answer. Upserts so
 * a contact who triggers the same campaign again after their previous
 * question expired (or after answering once, if they somehow retrigger it)
 * gets a fresh window rather than colliding with the unique constraint.
 */
export async function startCollection(input: StartCollectionInput) {
  return prisma.contactAnswer.upsert({
    where: {
      automationId_instagramUserId: {
        automationId: input.automationId,
        instagramUserId: input.instagramUserId,
      },
    },
    create: {
      workspaceId: input.workspaceId,
      automationId: input.automationId,
      instagramUserId: input.instagramUserId,
      commenterName: input.commenterName,
      question: input.question,
      fieldType: input.fieldType,
      triggerSource: input.trigger.source,
      triggerText: input.trigger.text,
      matchedKeyword: input.trigger.matchedKeyword,
      expiresAt: new Date(Date.now() + ANSWER_WINDOW_MS),
    },
    update: {
      status: "PENDING",
      answer: null,
      attempts: 0,
      question: input.question,
      fieldType: input.fieldType,
      triggerSource: input.trigger.source,
      triggerText: input.trigger.text,
      matchedKeyword: input.trigger.matchedKeyword,
      expiresAt: new Date(Date.now() + ANSWER_WINDOW_MS),
    },
  });
}

/**
 * Whether a campaign should ask its question rather than reveal the link
 * right now: enabled, and this contact hasn't already answered it. An
 * expired, never-answered question is treated as "ask again" — startCollection
 * upserts it a fresh window rather than erroring.
 */
export async function needsCollection(
  automation: {
    id: string;
    collectDataEnabled: boolean;
  },
  instagramUserId: string
): Promise<boolean> {
  if (!automation.collectDataEnabled) return false;
  const existing = await prisma.contactAnswer.findUnique({
    where: {
      automationId_instagramUserId: {
        automationId: automation.id,
        instagramUserId,
      },
    },
    select: { status: true },
  });
  return existing?.status !== "ANSWERED";
}

type PendingRow = NonNullable<Awaited<ReturnType<typeof findPending>>>;

export type AnswerOutcome =
  | { kind: "not_pending" }
  | { kind: "invalid"; message: string; attemptsRemaining: number; contactAnswer: PendingRow }
  | { kind: "gave_up"; contactAnswer: PendingRow }
  | { kind: "answered"; contactAnswer: PendingRow };

async function findPending(instagramAccountId: string, instagramUserId: string) {
  return prisma.contactAnswer.findFirst({
    where: {
      instagramUserId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
      automation: {
        collectDataEnabled: true,
        isActive: true,
        instagramAccount: { instagramId: instagramAccountId },
      },
    },
    include: {
      automation: {
        include: {
          instagramAccount: true,
          trackedLinks: {
            select: { slug: true, label: true, destinationUrl: true },
          },
        },
      },
    },
  });
}

/**
 * Check an inbound DM against any pending question for this contact on this
 * Instagram account. Call this before keyword matching in processMessage.
 * `not_pending` means "nothing waiting — fall through to normal matching".
 */
export async function tryAnswerPendingQuestion(
  instagramAccountId: string,
  instagramUserId: string,
  messageText: string
): Promise<AnswerOutcome> {
  const pending = await findPending(instagramAccountId, instagramUserId);
  if (!pending) return { kind: "not_pending" };

  const valid = validateAnswer(pending.fieldType, messageText);
  if (!valid) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_INVALID_ATTEMPTS) {
      const gaveUp = await prisma.contactAnswer.update({
        where: { id: pending.id },
        data: { status: "EXPIRED", attempts },
      });
      return { kind: "gave_up", contactAnswer: { ...pending, ...gaveUp } };
    }
    await prisma.contactAnswer.update({
      where: { id: pending.id },
      data: { attempts },
    });
    return {
      kind: "invalid",
      message:
        pending.automation.collectDataInvalidMessage?.trim() ||
        DEFAULT_INVALID_MESSAGE[pending.fieldType],
      attemptsRemaining: MAX_INVALID_ATTEMPTS - attempts,
      contactAnswer: pending,
    };
  }

  const answered = await prisma.contactAnswer.update({
    where: { id: pending.id },
    data: { status: "ANSWERED", answer: valid },
  });
  return { kind: "answered", contactAnswer: { ...pending, ...answered } };
}

export function contactAnswerToWebhookField(
  contactAnswer: { question: string; answer: string | null; fieldType: CollectDataFieldType } | null
): Prisma.InputJsonValue | undefined {
  if (!contactAnswer?.answer) return undefined;
  return {
    question: contactAnswer.question,
    answer: contactAnswer.answer,
    fieldType: contactAnswer.fieldType,
  };
}
