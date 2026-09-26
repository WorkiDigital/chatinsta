"use client";

/**
 * Signing secret, test button and recent deliveries for a saved campaign's
 * lead webhook. The URL itself is edited in the campaign builder; this panel
 * talks to /api/automations/webhook, the only route that serves the secret.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useState } from "react";

interface Delivery {
  id: string;
  event: string;
  status: "PENDING" | "SUCCESS" | "FAILED";
  statusCode: number | null;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
}

interface WebhookData {
  webhookUrl: string | null;
  secret: string | null;
  deliveries: Delivery[];
}

const STATUS_STYLES: Record<Delivery["status"], string> = {
  SUCCESS: "bg-success/10 text-success",
  FAILED: "bg-error/10 text-error",
  PENDING: "bg-warning/10 text-warning",
};

export default function WebhookSettings({ campaignId }: { campaignId: string }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<WebhookData | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState<"test" | "rotate" | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchData = useCallback(async (): Promise<WebhookData | null> => {
    const res = await fetch(`/api/automations/webhook?id=${campaignId}`, {
      cache: "no-store",
    });
    const payload = await res.json().catch(() => null);
    return payload?.success ? payload.data : null;
  }, [campaignId]);

  const load = useCallback(async () => {
    const next = await fetchData();
    if (next) setData(next);
  }, [fetchData]);

  useEffect(() => {
    let cancelled = false;
    fetchData()
      .then((next) => {
        if (!cancelled && next) setData(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  async function run(action: "test" | "rotate") {
    if (action === "rotate" && !window.confirm(t("Generate a new signing secret? Your receiver must be updated to the new one."))) {
      return;
    }
    setBusy(action);
    setNotice(null);
    try {
      const res = await fetch(`/api/automations/webhook?id=${campaignId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await res.json().catch(() => null);
      if (action === "rotate") {
        if (payload?.success) {
          setRevealed(true);
          setNotice({ ok: true, text: t("New secret generated.") });
        }
      } else if (payload?.success) {
        setNotice({
          ok: true,
          text: t("Test delivered (HTTP {status}).", {
            status: payload.data.statusCode ?? "?",
          }),
        });
      } else {
        setNotice({
          ok: false,
          text: payload?.data?.error ?? payload?.error ?? t("Test failed."),
        });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return <p className="text-xs text-muted">{t("Loading…")}</p>;
  }

  const secret = data.secret ?? "";
  const masked = secret ? `${secret.slice(0, 10)}${"•".repeat(12)}` : "—";

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <div>
        <p className="text-xs font-medium text-foreground">{t("Signing secret")}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface-hover px-2 py-1 text-xs text-foreground">
            {revealed ? secret : masked}
          </code>
          <button
            type="button"
            onClick={() => setRevealed(!revealed)}
            className="text-xs text-muted underline underline-offset-2 hover:text-foreground"
          >
            {revealed ? t("Hide") : t("Show")}
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(secret)}
            className="text-xs text-muted underline underline-offset-2 hover:text-foreground"
          >
            {t("Copy")}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          {t("Every request carries an X-OpenReply-Signature header signed with this secret, so your receiver can reject anything that didn't come from OpenReply.")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("test")}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-border-hover disabled:opacity-50"
        >
          {busy === "test" ? t("Sending…") : t("Send test")}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("rotate")}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
        >
          {t("Generate new secret")}
        </button>
      </div>
      {notice && (
        <p className={`text-xs ${notice.ok ? "text-success" : "text-error"}`}>{notice.text}</p>
      )}

      <div>
        <p className="text-xs font-medium text-foreground">{t("Recent deliveries")}</p>
        {data.deliveries.length === 0 ? (
          <p className="mt-1 text-xs text-muted">{t("No deliveries yet.")}</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {data.deliveries.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <p className="text-foreground">
                    {new Date(d.createdAt).toLocaleString(locale, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {d.statusCode ? ` · HTTP ${d.statusCode}` : ""}
                  </p>
                  {d.errorMessage && (
                    <p className="truncate text-error">{d.errorMessage}</p>
                  )}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[d.status]}`}>
                  {d.status === "SUCCESS" ? t("Delivered") : d.status === "FAILED" ? t("Failed") : t("Pending")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
