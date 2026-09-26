import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

// The 20 most recent collect-data answers for one campaign, newest first.
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const automationId = request.nextUrl.searchParams.get("id");
  if (!automationId) {
    return NextResponse.json(
      { success: false, error: "Missing campaign ID" },
      { status: 400 }
    );
  }

  const automation = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!automation) {
    return NextResponse.json(
      { success: false, error: "Campaign not found" },
      { status: 404 }
    );
  }

  const answers = await prisma.contactAnswer.findMany({
    where: { automationId },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      instagramUserId: true,
      commenterName: true,
      status: true,
      answer: true,
      fieldType: true,
      attempts: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ success: true, data: { answers } });
}
