import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { generateMcpToken } from "@/lib/mcp/api-keys";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});

async function requireManager() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return { response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canManageWorkspace(context.role)) {
    return {
      response: NextResponse.json(
        { success: false, error: "Only owners and admins can manage MCP keys" },
        { status: 403 }
      ),
    };
  }
  return { context };
}

export async function GET() {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const keys = await prisma.mcpApiKey.findMany({
    where: { workspaceId: auth.context.workspaceId },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ success: true, data: keys });
}

export async function POST(request: Request) {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const parsed = createKeySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Enter a name for this MCP key" },
      { status: 400 }
    );
  }

  const generated = generateMcpToken();
  const key = await prisma.mcpApiKey.create({
    data: {
      workspaceId: auth.context.workspaceId,
      name: parsed.data.name,
      tokenPrefix: generated.tokenPrefix,
      tokenHash: generated.tokenHash,
    },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true },
  });

  return NextResponse.json(
    {
      success: true,
      data: {
        ...key,
        token: generated.token,
        endpoint: new URL("/api/mcp", getBaseUrl()).toString(),
      },
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request) {
  const auth = await requireManager();
  if ("response" in auth) return auth.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing key ID" }, { status: 400 });
  }

  const result = await prisma.mcpApiKey.updateMany({
    where: { id, workspaceId: auth.context.workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) {
    return NextResponse.json({ success: false, error: "MCP key not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: { revoked: true } });
}
