import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import {
  buildWebhookBody,
  generateWebhookSecret,
  sendWebhookRequest,
  WEBHOOK_TEST_EVENT,
} from "@/lib/webhooks/outbound";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

// The only route that serves a campaign's webhook signing secret in plain
// text, so it is limited to owners and admins like every campaign write.
export const dynamic = "force-dynamic";

async function authorize(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return {
      error: NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      ),
    };
  }
  if (!canManageWorkspace(context.role)) {
    return {
      error: NextResponse.json(
        { success: false, error: "Only owners and admins can manage webhooks" },
        { status: 403 }
      ),
    };
  }
  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return {
      error: NextResponse.json(
        { success: false, error: "Missing campaign ID" },
        { status: 400 }
      ),
    };
  }
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId: context.workspaceId },
    select: {
      id: true,
      name: true,
      webhookUrl: true,
      webhookSecret: true,
      instagramAccount: { select: { instagramId: true, username: true } },
    },
  });
  if (!automation) {
    return {
      error: NextResponse.json(
        { success: false, error: "Campaign not found" },
        { status: 404 }
      ),
    };
  }
  return { automation };
}

// Current URL, plaintext secret, and the 20 most recent deliveries.
export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { automation } = auth;

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { automationId: automation.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      event: true,
      status: true,
      statusCode: true,
      attempts: true,
      errorMessage: true,
      createdAt: true,
      deliveredAt: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      webhookUrl: automation.webhookUrl,
      secret: automation.webhookSecret
        ? decryptToken(automation.webhookSecret)
        : null,
      deliveries,
    },
  });
}

const actionSchema = z.object({ action: z.enum(["test", "rotate"]) });

// `test` sends a signed sample payload right now and reports the receiver's
// response; `rotate` replaces the signing secret.
export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (auth.error) return auth.error;
  const { automation } = auth;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid action" },
      { status: 400 }
    );
  }

  if (parsed.data.action === "rotate") {
    const secret = generateWebhookSecret();
    await prisma.automation.update({
      where: { id: automation.id },
      data: { webhookSecret: encryptToken(secret) },
    });
    return NextResponse.json({ success: true, data: { secret } });
  }

  if (!automation.webhookUrl || !automation.webhookSecret) {
    return NextResponse.json(
      { success: false, error: "Save a webhook URL on this campaign first" },
      { status: 400 }
    );
  }

  const deliveryId = `test_${crypto.randomUUID()}`;
  const result = await sendWebhookRequest({
    url: automation.webhookUrl,
    secret: decryptToken(automation.webhookSecret),
    event: WEBHOOK_TEST_EVENT,
    deliveryId,
    body: buildWebhookBody({
      deliveryId,
      event: WEBHOOK_TEST_EVENT,
      occurredAt: new Date(),
      payload: {
        test: true,
        campaign: { id: automation.id, name: automation.name },
        instagramAccount: {
          id: automation.instagramAccount.instagramId,
          username: automation.instagramAccount.username,
        },
        contact: { instagramUserId: "test_user", username: "test_user" },
        trigger: { source: "comment", text: "Sample comment", matchedKeyword: null },
      },
    }),
  });

  return NextResponse.json({
    success: result.ok,
    data: { statusCode: result.statusCode, error: result.error },
  });
}
