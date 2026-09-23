import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({ $queryRaw: vi.fn(async () => [{ ok: 1 }]) }),
}));

import { GET } from "./route";

// What a scraper stores is this text. A series nothing writes is a zero that looks like a
// measurement — "no HTTP requests since boot" on a dashboard, forever.
describe("GET /api/metrics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exposes only series that something writes", async () => {
    const res = await GET(new Request("http://localhost/api/metrics"));
    const body = await res.text();

    expect(res.status).toBe(200);
    for (const live of [
      "email_sent_total",
      "email_failed_total",
      "process_uptime_seconds",
      "metrics_reset_timestamp_seconds",
    ]) {
      expect(body).toContain(live);
    }
    for (const dead of ["http_requests_total", "http_errors_total", "db_queries_total"]) {
      expect(body).not.toContain(dead);
    }
  });

  it("wants the INIT_SECRET bearer in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("INIT_SECRET", "scrape-secret");

    const refused = await GET(new Request("http://localhost/api/metrics"));
    const allowed = await GET(
      new Request("http://localhost/api/metrics", {
        headers: { authorization: "Bearer scrape-secret" },
      }),
    );

    expect(refused.status).toBe(403);
    expect(allowed.status).toBe(200);
  });
});
