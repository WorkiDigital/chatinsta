import { McpServer, requireScopes } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { buildInitialCampaignLinks, syncCampaignLinks } from "@/lib/campaigns/links";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  createInstagramContext,
  getConversations,
  getConversationMessages,
  sendDirectMessage,
  sendDirectMessageWithLinkButton,
} from "@/lib/instagram/provider";
import { getDiagnostics } from "@/lib/ops/get-diagnostics";
import { generateReportShareSlug } from "@/lib/reports/share";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";
import { reserveManualMessageSlot, releaseManualMessageSlot } from "@/lib/utils/rate-limiter";
import { encryptToken } from "@/lib/meta/oauth";
import {
  generateWebhookSecret,
  omitWebhookSecret,
  validateWebhookUrl,
} from "@/lib/webhooks/outbound";

// Same https/SSRF rules the campaign API and the sender enforce.
const webhookUrlField = z
  .string()
  .trim()
  .max(2048)
  .superRefine((value, ctx) => {
    const error = validateWebhookUrl(value);
    if (error) ctx.addIssue({ code: "custom", message: error });
  });

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

const READ_TOOL_AUTH = {
  scopeChallenge: requireScopes("flows:read"),
  _meta: {
    securitySchemes: [{ type: "oauth2", scopes: ["flows:read"] }],
  },
};

const WRITE_TOOL_AUTH = {
  scopeChallenge: requireScopes("flows:write"),
  _meta: {
    securitySchemes: [{ type: "oauth2", scopes: ["flows:write"] }],
  },
};

function isWithinMessagingWindow(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < TWENTY_FOUR_HOURS_MS;
}

// Cursors page over data the provider already fetched in one bounded call
// (Instagram exposes no server-side cursor for this beyond that window), so a
// cursor here is just an opaque offset into that already-fetched list.
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(Buffer.from(cursor, "base64").toString("utf8"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const targetSchema = z.enum(["any_post", "next_reel", "specific_post"]);

const createFlowSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    goal: z.string().trim().min(1).max(120).optional(),
    instagramAccountId: z.string().min(1).optional(),
    target: targetSchema,
    postId: z.string().min(1).optional(),
    postUrl: z.url().optional(),
    keywords: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
    matchAnyWord: z.boolean().default(false),
    dmTriggerEnabled: z.boolean().default(false),
    dmMessage: z.string().trim().min(1).max(1000),
    openingDmEnabled: z.boolean().default(false),
    openingDmMessage: z.string().trim().min(1).max(1000).optional(),
    openingDmButtonLabel: z.string().trim().min(1).max(64).optional(),
    trackedDestinationUrl: z.url().optional(),
    linkButtonLabel: z.string().trim().min(1).max(20).optional(),
    requireFollow: z.boolean().default(false),
    followPromptMessage: z.string().trim().min(1).max(1000).optional(),
    followPromptButtonLabel: z.string().trim().min(1).max(20).optional(),
    followUpEnabled: z.boolean().default(false),
    followUpMessage: z.string().trim().min(1).max(1000).optional(),
    followUpDelayMinutes: z.number().int().min(0).max(1440).default(0),
    webhookUrl: webhookUrlField.optional(),
    publicReplyMessages: z.array(z.string().trim().min(1).max(1000)).max(10).default([]),
    wholeWordMatch: z.boolean().default(true),
    isActive: z.boolean().default(false),
  })
  .superRefine((data, context) => {
    if (data.target === "specific_post" && !data.postId) {
      context.addIssue({ code: "custom", path: ["postId"], message: "postId is required for a specific post" });
    }
    if (!data.matchAnyWord && data.keywords.length === 0) {
      context.addIssue({ code: "custom", path: ["keywords"], message: "Provide a keyword or enable matchAnyWord" });
    }
    if (data.openingDmEnabled && !(data.openingDmMessage && data.openingDmButtonLabel)) {
      context.addIssue({
        code: "custom",
        path: ["openingDmMessage"],
        message: "Opening DM needs a message and a button label",
      });
    }
    if (data.requireFollow && !(data.followPromptMessage && data.followPromptButtonLabel)) {
      context.addIssue({
        code: "custom",
        path: ["followPromptMessage"],
        message: "The follow gate needs a prompt message and a button label",
      });
    }
    if (data.followUpEnabled && !data.followUpMessage) {
      context.addIssue({
        code: "custom",
        path: ["followUpMessage"],
        message: "The follow-up needs a message",
      });
    }
  });

const updateFlowSchema = z.object({
  flowId: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
  goal: z.union([z.string().trim().min(1).max(120), z.null()]).optional(),
  keywords: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  matchAnyWord: z.boolean().optional(),
  dmTriggerEnabled: z.boolean().optional(),
  dmMessage: z.string().trim().min(1).max(1000).optional(),
  openingDmEnabled: z.boolean().optional(),
  openingDmMessage: z.union([z.string().trim().min(1).max(1000), z.null()]).optional(),
  openingDmButtonLabel: z.union([z.string().trim().min(1).max(64), z.null()]).optional(),
  trackedDestinationUrl: z.union([z.url(), z.literal("")]).optional(),
  linkButtonLabel: z.union([z.string().trim().min(1).max(20), z.null()]).optional(),
  requireFollow: z.boolean().optional(),
  followPromptMessage: z.union([z.string().trim().min(1).max(1000), z.null()]).optional(),
  followPromptButtonLabel: z.union([z.string().trim().min(1).max(20), z.null()]).optional(),
  followUpEnabled: z.boolean().optional(),
  followUpMessage: z.union([z.string().trim().min(1).max(1000), z.null()]).optional(),
  followUpDelayMinutes: z.number().int().min(0).max(1440).optional(),
  webhookUrl: z.union([webhookUrlField, z.literal(""), z.null()]).optional(),
  publicReplyMessages: z.array(z.string().trim().min(1).max(1000)).max(10).optional(),
  wholeWordMatch: z.boolean().optional(),
});

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected MCP tool error";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function findWorkspaceFlow(workspaceId: string, flowId: string) {
  const flow = await prisma.automation.findFirst({
    where: { id: flowId, workspaceId },
    include: {
      instagramAccount: { select: { id: true, username: true, provider: true } },
      trackedLinks: { orderBy: TRACKED_LINK_ORDER },
    },
  });
  // Never hand the (encrypted) webhook signing secret to an MCP client.
  return flow ? omitWebhookSecret(flow) : null;
}

export function createInstaManyMcpServer(workspaceId: string) {
  const server = new McpServer(
    { name: "instamany-flows", version: "1.0.0" },
    {
      instructions:
        "Manage Instagram comment-to-DM flows and reply to DM conversations for one InstaMany workspace. New flows default to inactive " +
        "unless isActive is explicitly true. Read a flow before changing it. send_message refuses to send once Instagram's 24-hour " +
        "messaging window has closed.",
    }
  );

  server.registerTool(
    "list_instagram_accounts",
    {
      title: "List Instagram accounts",
      description: "List the Instagram accounts connected to this workspace. Use an account id when creating a flow.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
      ...READ_TOOL_AUTH,
    },
    async () => {
      try {
        const accounts = await prisma.instagramAccount.findMany({
          where: { workspaceId },
          select: {
            id: true,
            username: true,
            name: true,
            instagramId: true,
            provider: true,
            webhookSubscribed: true,
            connectedAt: true,
          },
          orderBy: { connectedAt: "desc" },
        });
        return jsonResult({ accounts });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_flows",
    {
      title: "List flows",
      description: "List flows in this workspace, optionally filtered by Instagram account or active status.",
      inputSchema: z.object({
        instagramAccountId: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      ...READ_TOOL_AUTH,
    },
    async ({ instagramAccountId, isActive }) => {
      try {
        const where: Prisma.AutomationWhereInput = {
          workspaceId,
          ...(instagramAccountId ? { instagramAccountId } : {}),
          ...(isActive === undefined ? {} : { isActive }),
        };
        const flows = await prisma.automation.findMany({
          where,
          select: {
            id: true,
            name: true,
            goal: true,
            postId: true,
            postUrl: true,
            pendingNextReel: true,
            matchAnyPost: true,
            keywords: true,
            matchAnyWord: true,
            dmTriggerEnabled: true,
            dmMessage: true,
            openingDmEnabled: true,
            requireFollow: true,
            followUpEnabled: true,
            webhookUrl: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            instagramAccount: { select: { id: true, username: true, provider: true } },
            _count: { select: { dmLogs: true, linkClicks: true } },
          },
          orderBy: { createdAt: "desc" },
        });
        return jsonResult({ flows });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_flow",
    {
      title: "Get flow",
      description: "Read the complete configuration of one flow before editing it.",
      inputSchema: z.object({ flowId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      ...READ_TOOL_AUTH,
    },
    async ({ flowId }) => {
      try {
        const flow = await findWorkspaceFlow(workspaceId, flowId);
        if (!flow) return errorResult(new Error("Flow not found"));
        return jsonResult({ flow });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "create_flow",
    {
      title: "Create flow",
      description:
        "Create an Instagram comment-to-DM flow. Targets can be any_post, next_reel, or specific_post. New flows are inactive by default. " +
        "Set openingDmEnabled with openingDmMessage and openingDmButtonLabel to send an opening DM whose link renders as a button instead of plain text. " +
        "Set requireFollow with followPromptMessage and followPromptButtonLabel to gate the link behind a follow check. " +
        "Set followUpEnabled with followUpMessage and followUpDelayMinutes (minutes to wait, 0-1440) to send a follow-up DM after the link is delivered. " +
        "Set webhookUrl (https only) to POST each new lead to your CRM/automation tool when they receive the link; the signing secret is managed in the dashboard.",
      inputSchema: createFlowSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      ...WRITE_TOOL_AUTH,
    },
    async (input) => {
      try {
        const account = await getWorkspaceInstagramAccount(workspaceId, input.instagramAccountId);
        if (!account) throw new Error("Connect an Instagram account before creating a flow");

        const matchAnyPost = input.target === "any_post";
        const pendingNextReel = input.target === "next_reel";
        const specificPost = input.target === "specific_post";
        const publicReplyMessages = input.publicReplyMessages.map((message) => message.trim());
        const links = buildInitialCampaignLinks({
          workspaceId,
          primaryUrl: input.trackedDestinationUrl,
        });

        const flow = await prisma.automation.create({
          data: {
            workspaceId,
            instagramAccountId: account.id,
            name: input.name,
            goal: input.goal ?? null,
            postId: specificPost ? input.postId : null,
            postUrl: specificPost ? input.postUrl ?? null : null,
            matchAnyPost,
            pendingNextReel,
            keywords: input.matchAnyWord ? [] : input.keywords,
            matchAnyWord: input.matchAnyWord,
            dmTriggerEnabled: input.dmTriggerEnabled,
            dmMessage: input.dmMessage,
            openingDmEnabled: input.openingDmEnabled,
            openingDmMessage: input.openingDmEnabled ? input.openingDmMessage ?? null : null,
            openingDmButtonLabel: input.openingDmEnabled ? input.openingDmButtonLabel ?? null : null,
            linkButtonLabel: input.linkButtonLabel ?? null,
            requireFollow: input.requireFollow,
            followPromptMessage: input.requireFollow ? input.followPromptMessage ?? null : null,
            followPromptButtonLabel: input.requireFollow ? input.followPromptButtonLabel ?? null : null,
            followUpEnabled: input.followUpEnabled,
            followUpMessage: input.followUpEnabled ? input.followUpMessage ?? null : null,
            followUpDelayMinutes: input.followUpEnabled ? input.followUpDelayMinutes : 0,
            webhookUrl: input.webhookUrl || null,
            webhookSecret: input.webhookUrl ? encryptToken(generateWebhookSecret()) : null,
            publicReplyEnabled: publicReplyMessages.length > 0,
            publicReplyMessage: publicReplyMessages[0] ?? null,
            publicReplyMessages,
            wholeWordMatch: input.wholeWordMatch,
            isActive: input.isActive,
            reportShareSlug: generateReportShareSlug(),
            ...(links.length ? { trackedLinks: { create: links } } : {}),
          },
          include: { trackedLinks: { orderBy: TRACKED_LINK_ORDER } },
        });
        return jsonResult({ created: true, flow: omitWebhookSecret(flow) });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "update_flow",
    {
      title: "Update flow",
      description:
        "Update the editable message and matching settings of an existing flow. Use an empty trackedDestinationUrl to remove its primary link. " +
        "Setting openingDmEnabled, requireFollow, or followUpEnabled to false clears that section's messages. " +
        "openingDmEnabled needs openingDmMessage and openingDmButtonLabel to actually send an opening DM. " +
        "Set webhookUrl to an https URL to send leads there, or to an empty string or null to stop.",
      inputSchema: updateFlowSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      ...WRITE_TOOL_AUTH,
    },
    async ({ flowId, trackedDestinationUrl, publicReplyMessages, ...changes }) => {
      try {
        const existing = await findWorkspaceFlow(workspaceId, flowId);
        if (!existing) throw new Error("Flow not found");

        const nextMatchAnyWord = changes.matchAnyWord ?? existing.matchAnyWord;
        const nextKeywords = changes.keywords ?? existing.keywords;
        if (!nextMatchAnyWord && nextKeywords.length === 0) {
          throw new Error("A flow needs at least one keyword unless matchAnyWord is enabled");
        }

        const nextOpeningDmEnabled = changes.openingDmEnabled ?? existing.openingDmEnabled;
        const nextOpeningDmMessage =
          changes.openingDmMessage !== undefined ? changes.openingDmMessage : existing.openingDmMessage;
        const nextOpeningDmButtonLabel =
          changes.openingDmButtonLabel !== undefined ? changes.openingDmButtonLabel : existing.openingDmButtonLabel;
        if (nextOpeningDmEnabled && !(nextOpeningDmMessage && nextOpeningDmButtonLabel)) {
          throw new Error("Opening DM needs a message and a button label");
        }

        const nextRequireFollow = changes.requireFollow ?? existing.requireFollow;
        const nextFollowPromptMessage =
          changes.followPromptMessage !== undefined ? changes.followPromptMessage : existing.followPromptMessage;
        const nextFollowPromptButtonLabel =
          changes.followPromptButtonLabel !== undefined
            ? changes.followPromptButtonLabel
            : existing.followPromptButtonLabel;
        if (nextRequireFollow && !(nextFollowPromptMessage && nextFollowPromptButtonLabel)) {
          throw new Error("The follow gate needs a prompt message and a button label");
        }

        const nextFollowUpEnabled = changes.followUpEnabled ?? existing.followUpEnabled;
        const nextFollowUpMessage =
          changes.followUpMessage !== undefined ? changes.followUpMessage : existing.followUpMessage;
        if (nextFollowUpEnabled && !nextFollowUpMessage) {
          throw new Error("The follow-up needs a message");
        }

        const data: Prisma.AutomationUpdateInput = { ...changes };
        if (changes.webhookUrl === "") data.webhookUrl = null;
        if (changes.webhookUrl && !existing.hasWebhookSecret) {
          data.webhookSecret = encryptToken(generateWebhookSecret());
        }
        if (changes.matchAnyWord === true) data.keywords = [];
        if (changes.openingDmEnabled === false) {
          data.openingDmMessage = null;
          data.openingDmButtonLabel = null;
        }
        if (changes.requireFollow === false) {
          data.followPromptMessage = null;
          data.followPromptButtonLabel = null;
        }
        if (changes.followUpEnabled === false) {
          data.followUpMessage = null;
          data.followUpDelayMinutes = 0;
        }
        if (publicReplyMessages !== undefined) {
          data.publicReplyMessages = publicReplyMessages;
          data.publicReplyMessage = publicReplyMessages[0] ?? null;
          data.publicReplyEnabled = publicReplyMessages.length > 0;
        }

        await prisma.$transaction(async (tx) => {
          await tx.automation.update({ where: { id: flowId }, data });
          await syncCampaignLinks(tx, {
            workspaceId,
            automationId: flowId,
            primaryUrl: trackedDestinationUrl,
          });
        });

        const flow = await findWorkspaceFlow(workspaceId, flowId);
        return jsonResult({ updated: true, flow });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "set_flow_status",
    {
      title: "Activate or pause flow",
      description: "Activate or pause one flow without changing the rest of its configuration.",
      inputSchema: z.object({ flowId: z.string().min(1), isActive: z.boolean() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      ...WRITE_TOOL_AUTH,
    },
    async ({ flowId, isActive }) => {
      try {
        const result = await prisma.automation.updateMany({
          where: { id: flowId, workspaceId },
          data: { isActive },
        });
        if (!result.count) throw new Error("Flow not found");
        return jsonResult({ updated: true, flowId, isActive });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_conversations",
    {
      title: "List conversations",
      description:
        "List Instagram DM conversations for one connected account, via the same Conversations API the dashboard inbox reads. " +
        "windowOpen is reported only when the most recent message in the list is inbound — Meta's list endpoint does not return enough " +
        "history to tell otherwise; it comes back null in that case, and get_conversation or send_message can resolve it. " +
        "unreadOnly is a best-effort filter (last message came from the contact with no reply since), since Instagram exposes no native " +
        "unread flag through this API. flowId is the automation whose DM most recently reached this contact, if any.",
      inputSchema: z.object({
        instagramAccountId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().min(1).optional(),
        unreadOnly: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      ...READ_TOOL_AUTH,
    },
    async ({ instagramAccountId, limit, cursor, unreadOnly }) => {
      try {
        const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
        if (!account) throw new Error("Instagram account not connected");

        const context = await createInstagramContext(account);
        const raw = await getConversations({ context, igUserId: account.instagramId });

        const shaped = raw.map((c) => {
          const participants = c.participants?.data ?? [];
          const contact = participants.find((p) => p.id !== account.instagramId) ?? null;
          const last = c.messages?.data?.[0] ?? null;
          const lastFromMe = last?.from ? last.from.id === account.instagramId : null;
          return {
            id: c.id,
            detailsUnavailable: c.detailsUnavailable ?? false,
            contact: { id: contact?.id ?? null, username: contact?.username ?? null },
            lastMessage: last
              ? { text: last.message ?? "", fromMe: lastFromMe, createdTime: last.created_time ?? null }
              : null,
            updatedTime: c.updated_time ?? null,
            windowOpen: lastFromMe === false ? isWithinMessagingWindow(last?.created_time) : null,
            flowId: null as string | null,
          };
        });

        const filtered = unreadOnly ? shaped.filter((c) => c.lastMessage?.fromMe === false) : shaped;

        const contactIds = Array.from(
          new Set(filtered.map((c) => c.contact.id).filter((id): id is string => Boolean(id)))
        );
        if (contactIds.length) {
          const logs = await prisma.dmLog.findMany({
            where: { workspaceId, instagramAccountId: account.id, commenterId: { in: contactIds } },
            orderBy: { createdAt: "desc" },
            select: { commenterId: true, automationId: true },
          });
          const latestFlowByContact = new Map<string, string>();
          for (const log of logs) {
            if (!latestFlowByContact.has(log.commenterId)) latestFlowByContact.set(log.commenterId, log.automationId);
          }
          for (const c of filtered) {
            if (c.contact.id) c.flowId = latestFlowByContact.get(c.contact.id) ?? null;
          }
        }

        const offset = decodeCursor(cursor);
        const page = filtered.slice(offset, offset + limit);
        const nextCursor = offset + limit < filtered.length ? encodeCursor(offset + limit) : null;

        return jsonResult({
          conversations: page,
          nextCursor,
          account: { id: account.id, username: account.username, instagramId: account.instagramId },
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_conversation",
    {
      title: "Get conversation",
      description:
        "Read the message history of one conversation, via the same Conversations API the dashboard inbox reads. Instagram exposes only " +
        "the ~20 most recent messages per thread; limit/cursor page within that set and do not reach further back. origin is 'flow' when a " +
        "flow's logged send lines up with that message's timestamp, 'manual' otherwise, and null for received messages.",
      inputSchema: z.object({
        conversationId: z.string().min(1),
        instagramAccountId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(30),
        cursor: z.string().min(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      ...READ_TOOL_AUTH,
    },
    async ({ conversationId, instagramAccountId, limit, cursor }) => {
      try {
        const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
        if (!account) throw new Error("Instagram account not connected");

        const context = await createInstagramContext(account);
        const raw = await getConversationMessages({ context, conversationId });

        const chronological = [...raw].sort((a, b) => {
          const ta = a.created_time ? new Date(a.created_time).getTime() : 0;
          const tb = b.created_time ? new Date(b.created_time).getTime() : 0;
          return ta - tb;
        });

        const contact = chronological.find((m) => m.from && m.from.id !== account.instagramId)?.from ?? null;

        // Best-effort origin tag: no message-level link to an automation exists,
        // so a sent message is attributed to a flow when it falls inside the
        // window that flow's logged DmLog (plus its own follow-up delay) covers
        // for this contact. Anything outside every such window is manual.
        let flowWindows: { start: number; end: number }[] = [];
        if (contact?.id) {
          const logs = await prisma.dmLog.findMany({
            where: {
              workspaceId,
              instagramAccountId: account.id,
              commenterId: contact.id,
              status: "SENT",
              dmSentAt: { not: null },
            },
            select: { dmSentAt: true, automation: { select: { followUpDelayMinutes: true } } },
          });
          const TOLERANCE_MS = 5 * 60_000;
          flowWindows = logs
            .filter((l) => l.dmSentAt)
            .map((l) => ({
              start: l.dmSentAt!.getTime() - 30_000,
              end:
                l.dmSentAt!.getTime() +
                Math.max(0, l.automation.followUpDelayMinutes) * 60_000 +
                TOLERANCE_MS,
            }));
        }

        const shaped = chronological.map((m) => {
          const fromMe = m.from?.id === account.instagramId;
          const t = m.created_time ? new Date(m.created_time).getTime() : NaN;
          const origin = !fromMe
            ? null
            : Number.isNaN(t)
              ? "manual"
              : flowWindows.some((w) => t >= w.start && t <= w.end)
                ? "flow"
                : "manual";
          return {
            id: m.id,
            direction: fromMe ? ("enviada" as const) : ("recebida" as const),
            text: m.message ?? "",
            createdTime: m.created_time ?? null,
            origin,
          };
        });

        const offset = decodeCursor(cursor);
        const page = shaped.slice(offset, offset + limit);
        const nextCursor = offset + limit < shaped.length ? encodeCursor(offset + limit) : null;

        return jsonResult({ conversationId, messages: page, nextCursor });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  const sendMessageSchema = z
    .object({
      conversationId: z.string().min(1),
      instagramAccountId: z.string().min(1).optional(),
      text: z.string().trim().min(1).max(1000),
      buttonLabel: z.string().trim().min(1).max(20).optional(),
      buttonUrl: z.url().optional(),
    })
    .superRefine((data, context) => {
      if (Boolean(data.buttonLabel) !== Boolean(data.buttonUrl)) {
        context.addIssue({
          code: "custom",
          path: ["buttonLabel"],
          message: "buttonLabel and buttonUrl must be provided together",
        });
      }
    });

  server.registerTool(
    "send_message",
    {
      title: "Send message",
      description:
        "Reply in an existing conversation, via the same send path the dashboard inbox uses. Refuses to send once Instagram's 24-hour " +
        "messaging window has closed since the contact's last message, returning a clear error instead. Rate-limited per Instagram account " +
        "to prevent mass sends. Pass buttonLabel and buttonUrl together to render the link as a tappable button instead of plain text; the " +
        "sent message shows up in the dashboard inbox like any manual reply, tagged as manual (not flow) origin.",
      inputSchema: sendMessageSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      ...WRITE_TOOL_AUTH,
    },
    async ({ conversationId, instagramAccountId, text, buttonLabel, buttonUrl }) => {
      try {
        const account = await getWorkspaceInstagramAccount(workspaceId, instagramAccountId);
        if (!account) throw new Error("Instagram account not connected");

        const context = await createInstagramContext(account);
        const raw = await getConversationMessages({ context, conversationId });

        const lastInbound = raw
          .filter((m) => m.from && m.from.id !== account.instagramId)
          .sort((a, b) => {
            const ta = a.created_time ? new Date(a.created_time).getTime() : 0;
            const tb = b.created_time ? new Date(b.created_time).getTime() : 0;
            return tb - ta;
          })[0];

        if (!lastInbound || !isWithinMessagingWindow(lastInbound.created_time)) {
          throw new Error("Janela de 24h fechada, o Instagram não permite enviar");
        }

        const recipientId = lastInbound.from!.id;

        const rate = await reserveManualMessageSlot(account.id);
        if (!rate.allowed) {
          throw new Error(
            "Rate limit exceeded: too many manual messages sent from this Instagram account in the last minute"
          );
        }

        try {
          const result =
            buttonLabel && buttonUrl
              ? await sendDirectMessageWithLinkButton({
                  context,
                  instagramAccountId: account.instagramId,
                  userId: recipientId,
                  text,
                  buttons: [{ title: buttonLabel, url: buttonUrl }],
                })
              : await sendDirectMessage({
                  context,
                  instagramAccountId: account.instagramId,
                  userId: recipientId,
                  message: text,
                });

          return jsonResult({ sent: true, conversationId, result });
        } catch (sendError) {
          await releaseManualMessageSlot(account.id);
          throw sendError;
        }
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_diagnostics",
    {
      title: "Get diagnostics",
      description:
        "Read the same data as the dashboard's Production Diagnostics page: DM queue depth, worker health/recent alerts, this workspace's " +
        "webhook/DM/token-refresh failures, and the operational event timeline. queueCounts, workerHealth, and workerAlerts describe the DM " +
        "worker and its job queue, which are shared infrastructure serving every workspace on this deployment, not just this one; everything " +
        "else (webhookFailures, dmFailures, tokenRefreshFailures, and the workspace-scoped rows in operationalEvents) is filtered to this " +
        "workspace.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
      ...READ_TOOL_AUTH,
    },
    async () => {
      try {
        const diagnostics = await getDiagnostics(workspaceId);
        return jsonResult(diagnostics);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}
