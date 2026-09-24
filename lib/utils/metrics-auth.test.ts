import { afterEach, describe, expect, it, vi } from "vitest";
import { requireMetricsToken } from "./metrics-auth";

const request = (authorization?: string) =>
  new Request("http://localhost/api/metrics", {
    headers: authorization ? { authorization } : {},
  });

describe("requireMetricsToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is open in development, as the counters always were", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(requireMetricsToken(request())).toBeNull();
  });

  it("admits the METRICS_TOKEN bearer in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("METRICS_TOKEN", "scrape-token");

    expect(requireMetricsToken(request("Bearer scrape-token"))).toBeNull();
  });

  // The reason for a token of its own: INIT_SECRET also opens /api/debug/db/init, so a scrape
  // config holding it held more than read access to counters.
  it("refuses INIT_SECRET, which it used to accept", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("METRICS_TOKEN", "scrape-token");
    vi.stubEnv("INIT_SECRET", "init-secret");

    expect(requireMetricsToken(request("Bearer init-secret"))?.status).toBe(403);
  });

  it("refuses everything in production while METRICS_TOKEN is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("METRICS_TOKEN", undefined);

    expect(requireMetricsToken(request())?.status).toBe(403);
    expect(requireMetricsToken(request("Bearer "))?.status).toBe(403);
    expect(requireMetricsToken(request("Bearer undefined"))?.status).toBe(403);
  });
});
