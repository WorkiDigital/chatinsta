import { prisma } from "@/lib/db/client";
import { ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getSessionUserId } from "@/lib/auth/session";
import { isEmailAllowedToSignIn } from "@/lib/env";

export type AppSession = {
  user: {
    id: string;
    email: string | null;
  };
} | null;

export async function auth(): Promise<AppSession> {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) return null;

  return { user: { id: user.id, email: user.email } };
}

export async function getCurrentUserId(): Promise<string | null> {
  return getSessionUserId();
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

export type AuthResult = { success: true } | { success: false; error: string };

export async function signUp(email: string, password: string): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isEmailAllowedToSignIn(normalizedEmail)) {
    return { success: false, error: "This email isn't allowed to sign up." };
  }

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // A row can already exist from a workspace invitation (no password yet) or
  // a pre-migration Supabase-auth account. Either way, claiming it with a
  // password here is correct — it's not a second account.
  if (existing?.passwordHash) {
    return { success: false, error: "An account with this email already exists." };
  }

  const passwordHash = hashPassword(password);
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } })
    : await prisma.user.create({ data: { email: normalizedEmail, passwordHash } });

  await ensureWorkspaceForUser(user.id, user.email);
  await createSession(user.id);
  return { success: true };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return { success: false, error: "Wrong email or password." };
  }
  if (!isEmailAllowedToSignIn(normalizedEmail)) {
    return { success: false, error: "This email isn't allowed to sign in." };
  }

  await createSession(user.id);
  return { success: true };
}

export async function signOut(): Promise<void> {
  await destroySession();
}
