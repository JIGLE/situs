import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({ user: { findUnique } }),
}));

import {
  clearSessionEpochCache,
  readSessionsValidFrom,
  rememberSessionsValidFrom,
  sessionEnded,
} from "@/lib/services/auth/session-epoch";

beforeEach(() => {
  findUnique.mockReset();
  clearSessionEpochCache();
});

describe("sessionEnded", () => {
  it("never ends a session while the account has no stamp", () => {
    expect(sessionEnded(1, null)).toBe(false);
    expect(sessionEnded(undefined, null)).toBe(false);
  });

  it("ends a session signed in before the stamp, and keeps one signed in at or after it", () => {
    expect(sessionEnded(999, 1000)).toBe(true);
    expect(sessionEnded(1000, 1000)).toBe(false);
    expect(sessionEnded(1001, 1000)).toBe(false);
  });

  it("ends a session that has no sign-in time, since it is older than any stamp", () => {
    expect(sessionEnded(undefined, 1000)).toBe(true);
    expect(sessionEnded("1500", 1000)).toBe(true);
    expect(sessionEnded(Number.NaN, 1000)).toBe(true);
  });
});

describe("readSessionsValidFrom", () => {
  it("reads the stamp as milliseconds, and null for an account with none", async () => {
    findUnique.mockResolvedValueOnce({ sessionsValidFrom: new Date(5_000) });
    await expect(readSessionsValidFrom("a", 0)).resolves.toBe(5_000);
    findUnique.mockResolvedValueOnce({ sessionsValidFrom: null });
    await expect(readSessionsValidFrom("b", 0)).resolves.toBeNull();
    findUnique.mockResolvedValueOnce(null);
    await expect(readSessionsValidFrom("c", 0)).resolves.toBeNull();
  });

  it("reads only the stamp, for the account asked about", async () => {
    findUnique.mockResolvedValue({ sessionsValidFrom: null });
    await readSessionsValidFrom("a", 0);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "a" },
      select: { sessionsValidFrom: true },
    });
  });

  it("asks the database again only once a few seconds have passed", async () => {
    findUnique.mockResolvedValue({ sessionsValidFrom: null });
    await readSessionsValidFrom("a", 0);
    await readSessionsValidFrom("a", 4_999);
    expect(findUnique).toHaveBeenCalledTimes(1);
    await readSessionsValidFrom("a", 5_000);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("keeps accounts apart", async () => {
    findUnique.mockResolvedValue({ sessionsValidFrom: null });
    await readSessionsValidFrom("a", 0);
    await readSessionsValidFrom("b", 0);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("takes the stamp the route just wrote, before the cache would have", async () => {
    findUnique.mockResolvedValue({ sessionsValidFrom: null });
    await readSessionsValidFrom("a", 0);
    rememberSessionsValidFrom("a", new Date(2_000), 1);
    await expect(readSessionsValidFrom("a", 2)).resolves.toBe(2_000);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("lets the error through when the database cannot be read, and caches nothing", async () => {
    findUnique.mockRejectedValueOnce(new Error("locked"));
    await expect(readSessionsValidFrom("a", 0)).rejects.toThrow("locked");
    findUnique.mockResolvedValueOnce({ sessionsValidFrom: new Date(7) });
    await expect(readSessionsValidFrom("a", 1)).resolves.toBe(7);
  });

  it("holds a bounded number of accounts", async () => {
    findUnique.mockResolvedValue({ sessionsValidFrom: null });
    for (let i = 0; i < 600; i++) await readSessionsValidFrom(`u${i}`, 0);
    findUnique.mockClear();
    // The oldest was dropped, the newest is still held.
    await readSessionsValidFrom("u599", 1);
    expect(findUnique).not.toHaveBeenCalled();
    await readSessionsValidFrom("u0", 1);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
