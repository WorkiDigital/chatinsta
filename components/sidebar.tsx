"use client";

import { signOutAction } from "@/app/login/sign-out-action";
import LanguageSwitcher from "@/components/language-switcher";
import { useI18n } from "@/lib/i18n/provider";
import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Overview", href: "/overview" },
  { label: "Inbox", href: "/inbox" },
  { label: "Campaigns", href: "/campaigns" },
  { label: "DM Logs", href: "/logs" },
  { label: "Settings", href: "/settings" },
  { label: "Diagnostics", href: "/diagnostics" },
] as const;

export default function Sidebar({ workspaceName }: { workspaceName: string }) {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <header className="shrink-0 border-b border-border bg-surface">
      <div
        className="flex min-h-16 items-center justify-between gap-4 px-4 lg:px-8"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <Link
          href="/dashboard"
          className="shrink-0 bg-clip-text text-base font-semibold text-transparent"
          style={{ backgroundImage: "var(--gradient-accent)" }}
        >
          OpenReply
        </Link>

        <details className="group relative ml-auto">
          <summary className="flex max-w-[min(55vw,22rem)] cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-surface-hover [&::-webkit-details-marker]:hidden">
            <span className="truncate text-foreground">{workspaceName}</span>
            <span className="shrink-0 text-xs text-muted transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-surface p-4 shadow-xl">
            <p className="truncate text-sm font-medium text-foreground">{workspaceName}</p>
            <p className="mt-0.5 text-xs text-muted">{t("Self-hosted")}</p>
            <div className="mt-4 border-t border-border pt-4">
              <LanguageSwitcher />
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="mt-4 text-xs text-muted underline underline-offset-2 hover:text-foreground"
              >
                {t("Sign out")}
              </button>
            </form>
          </div>
        </details>
      </div>

      <nav
        aria-label="Primary navigation"
        className="flex gap-1 overflow-x-auto px-4 pb-3 lg:px-8"
      >
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-accent/10 font-medium text-accent"
                  : "text-muted hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              {t(item.label)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
