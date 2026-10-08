// @vitest-environment node
import { describe, expect, it } from "vitest";
import config from "../next.config";

/**
 * `/_next/image` sits outside the proxy matcher, so anyone can ask it for an image. The hosts it may
 * fetch from are `images.remotePatterns`: with a wildcard there it is a server-side request to any
 * address a hostname resolves to, private ones included (GHSA-cjq9-62q9-8jv4, fixed in next 16.3.8).
 * The app uses next/image nowhere, so it names no host at all; a host added later is a named one,
 * never a pattern.
 */
describe("next.config images", () => {
  const images = config.images ?? {};

  it("allows no wildcard host to the image optimizer", () => {
    const wild = (images.remotePatterns ?? []).filter((pattern) => {
      const host = typeof pattern === "string" ? pattern : (pattern.hostname ?? "");
      return host.includes("*");
    });
    expect(wild).toEqual([]);
  });

  it("uses no `domains` list, which is a host pattern by another name", () => {
    expect(images.domains ?? []).toEqual([]);
  });
});
