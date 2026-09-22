import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";

export type AppSession = {
  user: {
    id: string;
    email: string | null;
  };
} | null;

/**
 * Maps the signed-in Supabase user onto our own Prisma `User` row, creating
 * it on first sight. Workspace, WorkspaceMember, etc. all key off this
 * Prisma id (a cuid), not the Supabase uuid, so the rest of the app never has
 * to know Supabase Auth exists.
 */
async function syncPrismaUser(supabaseId: string, email: string | null) {
  const existing = await prisma.user.findUnique({ where: { supabaseId } });
  if (existing) return existing;

  // A Prisma user with this email can already exist if it was created before
  // this project switched to Supabase Auth, or invited-by-email before ever
  // signing up. Link the accounts instead of creating a duplicate.
  if (email) {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: { supabaseId },
      });
    }
  }

  return prisma.user.create({ data: { supabaseId, email } });
}

export async function auth(): Promise<AppSession> {
  const supabase = await createClient();
  const {
    data: { user: supabaseUser },
  } = await supabase.auth.getUser();

  if (!supabaseUser) return null;

  const user = await syncPrismaUser(supabaseUser.id, supabaseUser.email ?? null);
  return { user: { id: user.id, email: user.email } };
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function getCurrentWorkspaceId(): Promise<string | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const workspace = await getPrimaryWorkspace(userId);
  if (workspace) return workspace.id;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const createdWorkspace = await ensureWorkspaceForUser(userId, user?.email);
  return createdWorkspace.id;
}
