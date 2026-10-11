import type { MetadataRoute } from "next";

import { DARK_THEME_COLOR } from "@/lib/theme/boot-script";

/**
 * Web App Manifest — makes Situs installable as a standalone app
 * (Android/Chrome "Add to Home screen", desktop PWA install).
 * Served at /manifest.webmanifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Situs — Sovereign Capital System",
    short_name: "Situs",
    description:
      "Property income, receipts and tax evidence under control — bank movement matching, receipt automation and document intelligence for EU property portfolios.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: DARK_THEME_COLOR,
    theme_color: DARK_THEME_COLOR,
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    /**
     * Long-press actions on the installed icon. Deliberately locale-less: `proxy.ts` resolves a
     * path with no `[locale]` segment from the `situs-locale` cookie, then `Accept-Language`,
     * so a shortcut opens in the language the visitor actually chose. Hardcoding `/pt/...` here
     * would pin every install to Portuguese.
     *
     * The manifest is static, so these cannot be translated per user — the labels stay English,
     * which is also what the OS shows for most installed apps' shortcut menus.
     */
    shortcuts: [
      { name: "Portfolio", short_name: "Portfolio", url: "/portfolio" },
      { name: "Finance", short_name: "Finance", url: "/financials" },
    ],
  };
}
