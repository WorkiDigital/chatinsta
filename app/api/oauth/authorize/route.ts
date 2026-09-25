import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  buildAuthorizationRedirect,
  generateAuthorizationCode,
  getOAuthIssuer,
  hashOAuthSecret,
  MCP_AUTHORIZATION_CODE_TTL_SECONDS,
  verifyAuthorizationIntent,
} from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

function redirectToClient(
  redirectUri: string,
  values: Record<string, string | undefined>
) {
  return NextResponse.redirect(buildAuthorizationRedirect(redirectUri, values), {
    status: 303,
  });
}

export async function POST(request: Request) {
  const issuer = getOAuthIssuer();
  if (request.headers.get("origin") !== issuer) {
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const form = await request.formData();
  const rawIntent = form.get("intent");
  const decision = form.get("decision");
  if (typeof rawIntent !== "string") {
    return Response.json({ error: "Missing authorization request" }, { status: 400 });
  }

  const intent = verifyAuthorizationIntent(rawIntent);
  if (!intent) {
    return Response.json(
      { error: "Authorization request is invalid or expired" },
      { status: 400 }
    );
  }

  const context = await getCurrentWorkspaceContext();
  if (
    !context ||
    !canManageWorkspace(context.role) ||
    context.userId !== intent.userId ||
    context.workspaceId !== intent.workspaceId
  ) {
    return redirectToClient(intent.redirectUri, {
      error: "access_denied",
      error_description: "The OpenReply session cannot authorize this workspace.",
      state: intent.state,
      iss: issuer,
    });
  }

  if (decision !== "approve") {
    return redirectToClient(intent.redirectUri, {
      error: "access_denied",
      error_description: "The user declined access.",
      state: intent.state,
      iss: issuer,
    });
  }

  const code = generateAuthorizationCode();
  await prisma.mcpOAuthAuthorizationCode.create({
    data: {
      codeHash: hashOAuthSecret(code),
      workspaceId: intent.workspaceId,
      userId: intent.userId,
      clientId: intent.clientId,
      redirectUri: intent.redirectUri,
      resource: intent.resource,
      scopes: intent.scopes,
      codeChallenge: intent.codeChallenge,
      expiresAt: new Date(
        Date.now() + MCP_AUTHORIZATION_CODE_TTL_SECONDS * 1000
      ),
    },
  });

  return redirectToClient(intent.redirectUri, {
    code,
    state: intent.state,
    iss: issuer,
  });
}
