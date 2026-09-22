import type { I18n } from "@/lib/i18n";

// Provider limitation notes are returned as codes (see
// app/api/instagram/posts/route.ts and app/api/instagram/overview/route.ts)
// rather than display text, since those API routes have no user locale to
// translate into. The client maps each code to a translated string here.
export function translateLimitationCode(t: I18n["t"], code: string): string {
  switch (code) {
    case "zernio_recent_posts_limit":
      return t("Zernio returns the 25 most recent Instagram posts.");
    case "zernio_post_reporting_limit":
      return t("Post reporting covers the 25 most recent Instagram posts.");
    case "zernio_insights_requires_addon":
      return t(
        "Insights and follower history require the Zernio Analytics add-on and reflect its last sync. Missing metrics remain unavailable."
      );
    default:
      return code;
  }
}
