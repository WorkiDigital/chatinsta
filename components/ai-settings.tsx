"use client";

/**
 * Per-workspace Anthropic API key, used by the "AI reply" campaign step
 * (lib/ai/reply.ts). Mirrors ZernioConnection's shape: save once, key never
 * shown again, delete to disconnect.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useState } from "react";

interface AiSettingsData {
  configured: boolean;
  model: string | null;
  allowedModels: readonly string[];
}

export function AiSettings({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<AiSettingsData | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async (): Promise<AiSettingsData> => {
    const response = await fetch("/api/ai/settings", { cache: "no-store" });
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.data;
  }, []);

  const refresh = useCallback(async () => {
    const next = await fetchData();
    setData(next);
    setModel(next.model ?? next.allowedModels[0] ?? "");
  }, [fetchData]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    fetchData()
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setModel(next.model ?? next.allowedModels[0] ?? "");
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load the AI connection.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManage, fetchData]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model: model || undefined }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      setApiKey("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not save this key."));
    } finally {
      setBusy(false);
    }
  }

  async function changeModel(nextModel: string) {
    setModel(nextModel);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: nextModel }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not change the model."));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError("");
    try {
      await fetch("/api/ai/settings", { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel rounded p-4 sm:p-6" aria-labelledby="ai-heading">
      <h2 id="ai-heading" className="text-base font-semibold">
        {t("AI replies")}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {t("Used by the campaign step that answers DMs matching no keyword. Get a key at")}{" "}
        <a
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          console.anthropic.com
        </a>
        .
      </p>
      {!canManage ? (
        <p className="mt-4 text-sm text-muted">
          {t("Ask your workspace owner or admin to configure this.")}
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="mt-4 rounded border border-error/30 bg-surface p-3 text-sm text-error">
              {error}
            </p>
          )}
          {!data?.configured ? (
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label className="block text-sm font-medium text-foreground" htmlFor="ai-api-key">
                {t("Anthropic API key")}
              </label>
              <input
                id="ai-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
              />
              <p className="text-xs text-muted">
                {t("Verified before saving, encrypted at rest, and never shown again.")}
              </p>
              <button
                type="submit"
                disabled={busy || !apiKey}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? t("Saving…") : t("Save API key")}
              </button>
            </form>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-foreground">{t("API key saved securely.")}</p>
              <div>
                <label className="block text-sm font-medium text-foreground" htmlFor="ai-model">
                  {t("Model")}
                </label>
                <select
                  id="ai-model"
                  value={model}
                  onChange={(e) => void changeModel(e.target.value)}
                  disabled={busy}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                >
                  {data.allowedModels.map((m) => (
                    <option key={m} value={m}>
                      {m.includes("haiku") ? t("Haiku (fast, cheap — recommended)") : t("Sonnet (stronger, costs more)")}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void disconnect()}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                {t("Remove key")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
