import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { buildInitialCampaignLinks, syncCampaignLinks } from "@/lib/campaigns/links";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { generateReportShareSlug } from "@/lib/reports/share";
import { TRACKED_LINK_ORDER } from "@/lib/tracking/link-order";

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
  return prisma.automation.findFirst({
    where: { id: flowId, workspaceId },
    include: {
      instagramAccount: { select: { id: true, username: true, provider: true } },
      trackedLinks: { orderBy: TRACKED_LINK_ORDER },
    },
  });
}

export function createInstaManyMcpServer(workspaceId: string) {
  const server = new McpServer(
    { name: "instamany-flows", version: "1.0.0" },
    {
      instructions:
        "Manage Instagram comment-to-DM flows for one InstaMany workspace. New flows default to inactive unless isActive is explicitly true. Read a flow before changing it.",
    }
  );

  server.registerTool(
    "list_instagram_accounts",
    {
      title: "List Instagram accounts",
      description: "List the Instagram accounts connected to this workspace. Use an account id when creating a flow.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
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
        "Set followUpEnabled with followUpMessage and followUpDelayMinutes (minutes to wait, 0-1440) to send a follow-up DM after the link is delivered.",
      inputSchema: createFlowSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
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
        return jsonResult({ created: true, flow });
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
        "openingDmEnabled needs openingDmMessage and openingDmButtonLabel to actually send an opening DM.",
      inputSchema: updateFlowSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
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

        const data: Prisma.AutomationUpdateInput = { ...changes };
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

  return server;
}
