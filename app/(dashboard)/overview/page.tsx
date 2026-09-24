"use client";

import type {
  OverviewPost,
  OverviewResponse,
} from "@/app/api/instagram/overview/route";
import FollowerChart from "@/components/follower-chart";
import type { Locale } from "@/lib/i18n";
import { translateLimitationCode } from "@/lib/i18n/limitation-codes";
import { useI18n } from "@/lib/i18n/provider";
import { useEffect, useMemo, useRef, useState } from "react";

const COUNT_OPTIONS = [
  { value: "25", label: "Last 25" },
  { value: "50", label: "Last 50" },
  { value: "100", label: "Last 100" },
  { value: "all", label: "All time" },
] as const;

type MetricIconName =
  | "views"
  | "likes"
  | "comments"
  | "saved"
  | "shares"
  | "posts";

function formatNumber(value: number | null, locale: Locale): string {
  if (value === null) return "\u2014";
  return new Intl.NumberFormat(locale, {
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value: number | null, locale: Locale): string {
  if (value === null) return "\u2014";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

function postInteractions(post: OverviewPost): number {
  return (
    post.likes +
    post.comments +
    (post.saved ?? 0) +
    (post.shares ?? 0)
  );
}

function MetricIcon({ name }: { name: MetricIconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      {name === "views" && (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      )}
      {name === "likes" && (
        <path d="M20.8 4.6a5.4 5.4 0 0 0-7.7 0L12 5.7l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.7l1.1 1.1L12 21l7.7-7.6 1.1-1.1a5.4 5.4 0 0 0 0-7.7Z" />
      )}
      {name === "comments" && (
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      )}
      {name === "saved" && (
        <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
      )}
      {name === "shares" && (
        <>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
        </>
      )}
      {name === "posts" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M3 9h18M9 21V9" />
        </>
      )}
    </svg>
  );
}

function MetricCard({
  label,
  value,
  icon,
  unavailable = false,
}: {
  label: string;
  value: string;
  icon: MetricIconName;
  unavailable?: boolean;
}) {
  return (
    <article className="panel group min-w-0 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted">{label}</p>
          <p
            className={
              "mt-3 text-2xl font-semibold tracking-[-0.035em] " +
              (unavailable ? "text-muted" : "text-foreground")
            }
          >
            {value}
          </p>
        </div>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-foreground transition-colors group-hover:border-accent/30 group-hover:text-accent">
          <MetricIcon name={icon} />
        </span>
      </div>
    </article>
  );
}

function PostThumbnail({
  post,
  className,
}: {
  post: OverviewPost;
  className: string;
}) {
  if (!post.thumbnailUrl) {
    return (
      <div
        aria-hidden="true"
        className={
          className +
          " grid shrink-0 place-items-center bg-gradient-to-br from-orange-100 to-rose-100 text-accent"
        }
      >
        <MetricIcon name="posts" />
      </div>
    );
  }

  return (
    // The source is supplied by Instagram and can use multiple CDN hosts.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={post.thumbnailUrl}
      alt=""
      loading="lazy"
      className={className + " shrink-0 object-cover"}
    />
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="h-[290px] animate-pulse rounded-[1.75rem] bg-[#201f1d]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="panel h-28 animate-pulse bg-surface/70" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="panel h-80 animate-pulse xl:col-span-2" />
        <div className="panel h-80 animate-pulse" />
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [count, setCount] = useState("50");
  const [retryToken, setRetryToken] = useState(0);
  const hasLoaded = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    if (hasLoaded.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    const params = new URLSearchParams({ count });
    if (selectedAccountId) {
      params.set("instagramAccountId", selectedAccountId);
    }

    async function loadOverview() {
      try {
        const response = await fetch(
          "/api/instagram/overview?" + params.toString(),
          { signal: controller.signal }
        );
        const payload = (await response.json().catch(() => null)) as
          | {
              success?: boolean;
              data?: OverviewResponse;
              error?: string;
            }
          | null;

        if (!response.ok || !payload?.success || !payload.data) {
          throw new Error(payload?.error ?? "Failed to load overview");
        }

        if (active) {
          setData(payload.data);
          setError(null);
          hasLoaded.current = true;
        }
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === "AbortError"
        ) {
          return;
        }
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to load overview"
          );
        }
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadOverview();

    return () => {
      active = false;
      controller.abort();
    };
  }, [count, retryToken, selectedAccountId]);

  const topPost = useMemo(() => {
    if (!data?.posts.length) return null;
    return data.posts.reduce((best, post) =>
      postInteractions(post) > postInteractions(best) ? post : best
    );
  }, [data]);

  if (loading && !data) {
    return <OverviewSkeleton />;
  }

  if (!data) {
    const needsConnection = error?.toLowerCase().includes("connect");
    return (
      <section className="panel mx-auto max-w-2xl px-6 py-14 text-center sm:px-10">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-error">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-6 w-6"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6M12 17h.01" />
          </svg>
        </span>
        <h2 className="mt-5 text-lg font-semibold text-foreground">
          {t("Failed to load overview")}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          {error}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => setRetryToken((value) => value + 1)}
            className="min-h-11 rounded-xl bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            {t("Try again")}
          </button>
          {needsConnection && (
            <a
              href="/api/instagram/connect"
              className="inline-flex min-h-11 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:border-border-hover hover:bg-surface-hover"
            >
              {t("Connect Instagram")}
            </a>
          )}
        </div>
      </section>
    );
  }

  const {
    account,
    accounts,
    followerHistory,
    followers,
    insightsAvailable,
    posts,
    totals,
  } = data;
  const selectedValue = selectedAccountId || account.id;
  const engagementRate =
    insightsAvailable && totals.reach > 0
      ? (totals.interactions / totals.reach) * 100
      : null;
  const averageInteractions =
    insightsAvailable && totals.posts > 0
      ? totals.interactions / totals.posts
      : null;
  const rangeDescription =
    t(totals.posts === 1 ? "{count} post" : "{count} posts", {
      count: totals.posts,
    }) +
    (data.truncated
      ? t(" (capped at {count})", { count: totals.posts })
      : "");
  const interactionItems = [
    { label: t("Likes"), value: totals.likes, color: "bg-[#c4490c]" },
    { label: t("Comments"), value: totals.comments, color: "bg-[#d97706]" },
    {
      label: t("Saved"),
      value: insightsAvailable ? totals.saved : null,
      color: "bg-[#2563eb]",
    },
    {
      label: t("Shares"),
      value: insightsAvailable ? totals.shares : null,
      color: "bg-[#7c3aed]",
    },
  ];
  const maxInteraction = Math.max(
    1,
    ...interactionItems.map((item) => item.value ?? 0)
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="relative overflow-hidden rounded-[1.75rem] bg-[#1d1c1a] px-5 py-6 text-white shadow-[0_20px_60px_rgba(25,24,22,0.18)] sm:px-8 sm:py-8">
        <div
          aria-hidden="true"
          className="absolute -right-24 -top-40 h-80 w-80 rounded-full bg-orange-500/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-rose-500/10 blur-3xl"
        />

        {refreshing && (
          <div
            className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-white/10"
            role="status"
            aria-live="polite"
          >
            <div className="h-full w-1/2 animate-pulse bg-orange-400" />
            <span className="sr-only">{t("Updating data...")}</span>
          </div>
        )}

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/55">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]" />
              Instagram
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
              {t("Instagram performance")}
            </h2>
            <p className="mt-1.5 text-sm text-white/55">
              @{account.username} <span aria-hidden="true">·</span>{" "}
              {rangeDescription}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                {t("Range")}
              </span>
              <select
                value={count}
                onChange={(event) => setCount(event.target.value)}
                className="min-h-11 min-w-36 rounded-xl border border-white/10 bg-white/10 px-3 text-sm text-white outline-none backdrop-blur-sm transition-colors hover:bg-white/15 focus:border-orange-400"
              >
                {COUNT_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    className="bg-[#1d1c1a]"
                  >
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </label>
            {accounts.length > 1 && (
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                  {t("Instagram account")}
                </span>
                <select
                  value={selectedValue}
                  onChange={(event) =>
                    setSelectedAccountId(event.target.value)
                  }
                  className="min-h-11 min-w-44 rounded-xl border border-white/10 bg-white/10 px-3 text-sm text-white outline-none backdrop-blur-sm transition-colors hover:bg-white/15 focus:border-orange-400"
                >
                  {accounts.map((option) => (
                    <option
                      key={option.id}
                      value={option.id}
                      className="bg-[#1d1c1a]"
                    >
                      @{option.username}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="relative mt-9 grid gap-7 border-t border-white/10 pt-7 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:gap-4">
          <div>
            <p className="text-xs font-medium text-white/50">{t("Reach")}</p>
            <p className="mt-2 text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">
              {formatNumber(insightsAvailable ? totals.reach : null, locale)}
            </p>
            <p className="mt-2 text-xs text-white/40">
              {t("Aggregated across selected posts")}
            </p>
          </div>
          <div className="border-white/10 lg:border-l lg:pl-6">
            <p className="text-xs font-medium text-white/50">
              {t("Engagement rate")}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
              {formatPercent(engagementRate, locale)}
            </p>
          </div>
          <div className="border-white/10 lg:border-l lg:pl-6">
            <p className="text-xs font-medium text-white/50">
              {t("Interactions")}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
              {formatNumber(
                insightsAvailable ? totals.interactions : null,
                locale
              )}
            </p>
          </div>
          <div className="border-white/10 lg:border-l lg:pl-6">
            <p className="text-xs font-medium text-white/50">
              {t("Followers")}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
              {formatNumber(followers, locale)}
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setRetryToken((value) => value + 1)}
            className="min-h-10 shrink-0 self-start rounded-xl border border-red-200 bg-white px-4 font-semibold transition-colors hover:bg-red-100 sm:self-auto"
          >
            {t("Try again")}
          </button>
        </div>
      )}

      {data.limitationCodes?.map((code) => (
        <div
          key={code}
          className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950"
        >
          <span
            aria-hidden="true"
            className="mt-2 h-2 w-2 shrink-0 rounded-full bg-amber-500"
          />
          <p>{translateLimitationCode(t, code)}</p>
        </div>
      ))}

      {!insightsAvailable && (
        <div className="flex flex-col gap-4 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-orange-950">
              {t("Instagram permissions required")}
            </p>
            <p className="mt-1 text-sm leading-6 text-orange-900/70">
              {t(
                "Views, reach, saved and shares need the insights permission."
              )}
            </p>
          </div>
          <a
            href="/api/instagram/connect"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-orange-950 px-4 text-sm font-semibold text-white transition-colors hover:bg-black"
          >
            {t("Reconnect Instagram")}
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label={t("Views")}
          value={formatNumber(
            insightsAvailable ? totals.views : null,
            locale
          )}
          icon="views"
          unavailable={!insightsAvailable}
        />
        <MetricCard
          label={t("Likes")}
          value={formatNumber(totals.likes, locale)}
          icon="likes"
        />
        <MetricCard
          label={t("Comments")}
          value={formatNumber(totals.comments, locale)}
          icon="comments"
        />
        <MetricCard
          label={t("Saved")}
          value={formatNumber(
            insightsAvailable ? totals.saved : null,
            locale
          )}
          icon="saved"
          unavailable={!insightsAvailable}
        />
        <MetricCard
          label={t("Shares")}
          value={formatNumber(
            insightsAvailable ? totals.shares : null,
            locale
          )}
          icon="shares"
          unavailable={!insightsAvailable}
        />
        <MetricCard
          label={t("Posts analyzed")}
          value={formatNumber(totals.posts, locale)}
          icon="posts"
        />
      </div>

      <div className="grid items-stretch gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <FollowerChart data={followerHistory} followers={followers} />
        </div>

        <section className="panel flex min-h-full flex-col p-5 sm:p-7">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t("Engagement")}
            </p>
            <h2 className="mt-1 text-base font-semibold tracking-[-0.01em] text-foreground">
              {t("Interaction mix")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("Average per post")}:{" "}
              <span className="font-semibold text-foreground">
                {formatNumber(averageInteractions, locale)}
              </span>
            </p>
          </div>

          <div className="mt-7 space-y-5">
            {interactionItems.map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="flex items-center gap-2 text-muted">
                    <span
                      aria-hidden="true"
                      className={"h-2 w-2 rounded-full " + item.color}
                    />
                    {item.label}
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatNumber(item.value, locale)}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background">
                  <div
                    className={"h-full rounded-full " + item.color}
                    style={{
                      width:
                        item.value === null
                          ? "0%"
                          : Math.max(
                              item.value > 0 ? 4 : 0,
                              (item.value / maxInteraction) * 100
                            ) + "%",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {topPost && (
            <div className="mt-auto border-t border-border pt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                {t("Best performing post")}
              </p>
              <div className="mt-3 flex items-center gap-3">
                <PostThumbnail
                  post={topPost}
                  className="h-12 w-12 rounded-xl"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {topPost.caption ||
                      t("{type} post", { type: topPost.mediaType })}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatNumber(postInteractions(topPost), locale)}{" "}
                    {t("Interactions").toLowerCase()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              Instagram
            </p>
            <h2 className="mt-1 text-base font-semibold tracking-[-0.01em] text-foreground">
              {t("Content performance")}
            </h2>
          </div>
          <p className="text-sm text-muted">{rangeDescription}</p>
        </div>

        {posts.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-background text-muted">
              <MetricIcon name="posts" />
            </span>
            <p className="mt-4 text-sm font-medium text-foreground">
              {t("No posts found")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] text-sm">
                <caption className="sr-only">{t("Content performance")}</caption>
                <thead>
                  <tr className="border-b border-border bg-background/65 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    <th scope="col" className="px-7 py-3 font-semibold">
                      {t("Post")}
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">
                      {t("Reach")}
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">
                      {t("Views")}
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">
                      {t("Likes")}
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">
                      {t("Comments")}
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">
                      {t("Saved")}
                    </th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">
                      {t("Shares")}
                    </th>
                    <th scope="col" className="px-7 py-3 text-right font-semibold">
                      {t("Date")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr
                      key={post.id}
                      className="border-b border-border last:border-0 hover:bg-background/55"
                    >
                      <th scope="row" className="max-w-sm px-7 py-3.5 text-left font-normal">
                        <div className="flex items-center gap-3">
                          <PostThumbnail
                            post={post}
                            className="h-11 w-11 rounded-xl"
                          />
                          <div className="min-w-0">
                            {post.permalink ? (
                              <a
                                href={post.permalink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate font-medium text-foreground transition-colors hover:text-accent"
                              >
                                {post.caption ||
                                  t("{type} post", {
                                    type: post.mediaType,
                                  })}
                              </a>
                            ) : (
                              <span className="block truncate font-medium text-foreground">
                                {post.caption ||
                                  t("{type} post", {
                                    type: post.mediaType,
                                  })}
                              </span>
                            )}
                            <span className="mt-0.5 block text-xs text-muted">
                              {post.mediaType}
                            </span>
                          </div>
                        </div>
                      </th>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted">
                        {formatNumber(post.reach, locale)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted">
                        {formatNumber(post.views, locale)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted">
                        {formatNumber(post.likes, locale)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted">
                        {formatNumber(post.comments, locale)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted">
                        {formatNumber(post.saved, locale)}
                      </td>
                      <td className="px-3 py-3.5 text-right tabular-nums text-muted">
                        {formatNumber(post.shares, locale)}
                      </td>
                      <td className="whitespace-nowrap px-7 py-3.5 text-right text-muted">
                        {formatDate(post.timestamp, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {posts.map((post) => (
                <article key={post.id} className="p-5">
                  <div className="flex items-start gap-3">
                    <PostThumbnail
                      post={post}
                      className="h-14 w-14 rounded-xl"
                    />
                    <div className="min-w-0 flex-1">
                      {post.permalink ? (
                        <a
                          href={post.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 text-sm font-semibold leading-5 text-foreground"
                        >
                          {post.caption ||
                            t("{type} post", { type: post.mediaType })}
                        </a>
                      ) : (
                        <p className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">
                          {post.caption ||
                            t("{type} post", { type: post.mediaType })}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted">
                        {formatDate(post.timestamp, locale)}
                      </p>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-background p-3">
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">
                        {t("Reach")}
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">
                        {formatNumber(post.reach, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">
                        {t("Likes")}
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">
                        {formatNumber(post.likes, locale)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted">
                        {t("Comments")}
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-foreground">
                        {formatNumber(post.comments, locale)}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
