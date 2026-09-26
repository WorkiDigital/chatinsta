import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { encryptToken } from "@/lib/meta/oauth";
import { ALLOWED_AI_MODELS, verifyAnthropicApiKey } from "@/lib/ai/reply";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

// Owner/admin-only, same as every other per-workspace connection route
// (Zernio, webhooks). The key itself is never returned once saved.
export const dynamic = "force-dynamic";

async function requireManager() {
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
        { success: false, error: "Only owners and admins can manage the AI connection" },
        { status: 403 }
      ),
    };
  }
  return { workspaceId: context.workspaceId };
}

export async function GET() {
  const auth = await requireManager();
  if (auth.error) return auth.error;

  const connection = await prisma.aiConnection.findUnique({
    where: { workspaceId: auth.workspaceId },
    select: { model: true, updatedAt: true },
  });

  return NextResponse.json({
    success: true,
    data: {
      configured: Boolean(connection),
      model: connection?.model ?? null,
      updatedAt: connection?.updatedAt ?? null,
      allowedModels: ALLOWED_AI_MODELS,
    },
  });
}

const saveSchema = z.object({
  apiKey: z.string().trim().min(10).max(200),
  model: z.enum(ALLOWED_AI_MODELS).optional(),
});

export async function POST(request: NextRequest) {
  const auth = await requireManager();
  if (auth.error) return auth.error;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Provide a valid Anthropic API key" },
      { status: 400 }
    );
  }

  try {
    await verifyAnthropicApiKey(parsed.data.apiKey);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Could not verify this key",
      },
      { status: 400 }
    );
  }

  await prisma.aiConnection.upsert({
    where: { workspaceId: auth.workspaceId },
    create: {
      workspaceId: auth.workspaceId,
      apiKey: encryptToken(parsed.data.apiKey),
      model: parsed.data.model ?? null,
    },
    update: {
      apiKey: encryptToken(parsed.data.apiKey),
      ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
    },
  });

  return NextResponse.json({ success: true });
}

const modelSchema = z.object({ model: z.enum(ALLOWED_AI_MODELS) });

// Change the model without re-entering the key.
export async function PATCH(request: NextRequest) {
  const auth = await requireManager();
  if (auth.error) return auth.error;

  const parsed = modelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid model" },
      { status: 400 }
    );
  }

  const existing = await prisma.aiConnection.findUnique({
    where: { workspaceId: auth.workspaceId },
  });
  if (!existing) {
    return NextResponse.json(
      { success: false, error: "Save an API key first" },
      { status: 400 }
    );
  }

  await prisma.aiConnection.update({
    where: { workspaceId: auth.workspaceId },
    data: { model: parsed.data.model },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE() {
  const auth = await requireManager();
  if (auth.error) return auth.error;

  await prisma.aiConnection
    .delete({ where: { workspaceId: auth.workspaceId } })
    .catch(() => {}); // already absent is not an error

  return NextResponse.json({ success: true });
}
