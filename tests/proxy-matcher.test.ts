// @vitest-environment node
import { describe, it, expect } from "vitest";

import { config } from "../proxy";

/**
 * Which paths the proxy runs on at all.
 *
 * It rewrites every address that carries no language prefix to `/<locale>/…`. A generated
 * metadata route such as `/opengraph-image` has no extension to be excluded by, so it was
 * rewritten to `/pt/opengraph-image`, which does not exist: the card answered 404 and every link
 * preview of the site showed none. It only shows on a real build (`next dev` serves it
 * differently), so this pins the matcher itself.
 */
const matcher = new RegExp(`^${config.matcher[0]}$`);
const runsOn = (path: string) => matcher.test(path);

describe("proxy matcher", () => {
  it.each([
    "/opengraph-image",
    "/twitter-image",
    "/robots.txt",
    "/manifest.webmanifest",
    "/favicon.ico",
    "/icon.svg",
    "/apple-touch-icon.png",
    "/version.json",
    "/sw.js",
    "/_next/static/chunks/main.js",
  ])("leaves %s alone", (path) => {
    expect(runsOn(path)).toBe(false);
  });

  it.each(["/", "/dashboard", "/auth/signin", "/privacy", "/portfolio/abc", "/api/properties"])(
    "still runs on %s",
    (path) => {
      expect(runsOn(path)).toBe(true);
    },
  );
});
