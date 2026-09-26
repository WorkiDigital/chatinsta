"use client";

/**
 * The 20 most recent collect-data answers for a saved campaign, shown under
 * the question toggle in the builder. Read-only: talks to
 * /api/automations/collected-data, its own route so this stays useful even
 * without opening a conversation.
 */

import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useState } from "react";

interface Answer {
  id: string;
  instagramUserId: string;
  commenterName: string | null;
  status: "PENDING" | "ANSWERED" | "EXPIRED";
  answer: string | null;
  attempts: number;
  updatedAt: string;
}

const STATUS_STYLES: Record<Answer["status"], string> = {
  ANSWERED: "bg-success/10 text-success",
  PENDING: "bg-warning/10 text-warning",
  EXPIRED: "bg-muted/10 text-muted",
};

export default function CollectedAnswers({ campaignId }: { campaignId: string }) {
  const { t, locale } = useI18n();
  const [answers, setAnswers] = useState<Answer[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/automations/collected-data?id=${campaignId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && payload?.success) setAnswers(payload.data.answers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  if (!answers) return <p className="text-xs text-muted">{t("Loading…")}</p>;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="text-xs font-medium text-foreground">{t("Recent answers")}</p>
      {answers.length === 0 ? (
        <p className="text-xs text-muted">{t("No answers yet.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {answers.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2 py-1.5 text-xs">
              <div className="min-w-0">
                <p className="truncate text-foreground">
                  {a.commenterName ? `@${a.commenterName}` : a.instagramUserId}
                  {a.status === "ANSWERED" && a.answer ? ` — ${a.answer}` : ""}
                </p>
                <p className="text-muted">
                  {new Date(a.updatedAt).toLocaleString(locale, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[a.status]}`}>
                {a.status === "ANSWERED"
                  ? t("Answered")
                  : a.status === "EXPIRED"
                    ? t("Gave up")
                    : t("Waiting")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
