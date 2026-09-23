"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { signUpAction, signInAction } from "@/app/login/actions";

type Mode = "sign-in" | "sign-up";

export default function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const action = mode === "sign-up" ? signUpAction : signInAction;
    const result = await action(email, password);

    if (!result.success) {
      setError(result.error);
      setBusy(false);
      return;
    }
    window.location.assign(callbackUrl);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium text-foreground">
          {t("Work email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium text-foreground">
          {t("Password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
        />
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-indigo-500/25 transition-all hover:shadow-indigo-500/30 disabled:opacity-50"
      >
        {busy
          ? t("Please wait…")
          : mode === "sign-up"
            ? t("Create account")
            : t("Sign in")}
      </button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
        }}
        className="w-full text-center text-sm text-muted hover:text-foreground transition-colors"
      >
        {mode === "sign-in"
          ? t("No account yet? Create one")
          : t("Already have an account? Sign in")}
      </button>
    </form>
  );
}
