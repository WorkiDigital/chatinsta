"use server";

import { signIn, signUp, type AuthResult } from "@/lib/auth";

export async function signUpAction(email: string, password: string): Promise<AuthResult> {
  if (!email || !password) {
    return { success: false, error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { success: false, error: "Password must be at least 8 characters." };
  }
  return signUp(email, password);
}

export async function signInAction(email: string, password: string): Promise<AuthResult> {
  if (!email || !password) {
    return { success: false, error: "Email and password are required." };
  }
  return signIn(email, password);
}
