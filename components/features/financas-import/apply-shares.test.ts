import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyShares } from "./apply-shares";

const { apiFetch } = vi.hoisted(() => {
  let n = 0;
  return { apiFetch: vi.fn(async () => ({ id: `owner-${++n}` })) };
});
vi.mock("@/lib/utils/api-client", () => ({ apiFetch }));

/** One import that names the same people on several properties adds each of them once. */
describe("applyShares", () => {
  beforeEach(() => apiFetch.mockClear());

  it("adds a person once across properties, by NIF or, without a valid one, by name", async () => {
    const added = new Map<string, string>();
    const shares = [
      { ownerId: null, name: "José Exemplo", taxId: "123456789", percentage: 50 },
      { ownerId: null, name: "Ana Exemplo", taxId: null, percentage: 50 },
    ];
    await applyShares("p1", shares, added);
    await applyShares("p2", shares, added);

    const urls = (apiFetch.mock.calls as unknown as [string][]).map(([url]) => url);
    expect(urls.filter((u) => u === "/api/owners")).toHaveLength(2);
    expect(urls.filter((u) => u === "/api/property-owners")).toHaveLength(4);
  });
});
