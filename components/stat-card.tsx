"use client";

import { useI18n } from "@/lib/i18n/provider";


/**
 * Stat Card
 *
 * Metric panel with label, value, and optional trend.
 */

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: string;
  trendUp?: boolean;
  /** Renders on the gradient accent fill instead of the neutral panel — use
   * on the one metric that most deserves the eye first. */
  highlight?: boolean;
}

export default function StatCard({ label, value, trend, trendUp, highlight }: StatCardProps) {
  const { t } = useI18n();

  if (highlight) {
    return (
      <div className="rounded p-4 text-white" style={{ background: "var(--gradient-accent)", boxShadow: "var(--shadow-soft)" }}>
        <p className="text-sm text-white/80">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        {trend && (
          <p className="text-xs mt-1 text-white/90">
            {trendUp ? "Up" : t("Down")} {trend}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="panel p-4 hover:shadow-[var(--shadow-soft-hover)]">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-1">{value}</p>
      {trend && (
        <p className={`text-xs mt-1 ${trendUp ? "text-success" : "text-error"}`}>
          {trendUp ? "Up" : t("Down")} {trend}
        </p>
      )}
    </div>
  );
}
