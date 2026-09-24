/**
 * The counter endpoint takes `METRICS_TOKEN`, and nothing else, in production.
 *
 * It took `INIT_SECRET`, through its own copy of the same check. That secret also opens
 * `/api/debug/db/init`, so a Prometheus scrape config held more than read access to counters. One
 * helper now serves it; this pins the route to that helper rather than to a copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({ $queryRaw: vi.fn(async () => [{ ok: 1 }]) }),
}));

import { GET as scrape } from "@/app/api/metrics/route";

const routes = [["/api/metrics", scrape]] as const;

const get = (path: string, bearer?: string) =>
  new NextRequest(`http://localhost${path}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

describe("counter endpoints in production", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("METRICS_TOKEN", "scrape-token");
    vi.stubEnv("INIT_SECRET", "init-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(routes)("%s admits METRICS_TOKEN", async (path, handler) => {
    expect((await handler(get(path, "scrape-token"))).status).toBe(200);
  });

  it.each(routes)("%s refuses INIT_SECRET", async (path, handler) => {
    expect((await handler(get(path, "init-secret"))).status).toBe(403);
  });

  it.each(routes)("%s refuses a request with no bearer", async (path, handler) => {
    expect((await handler(get(path))).status).toBe(403);
  });
});
