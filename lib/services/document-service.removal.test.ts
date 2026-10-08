// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Erasing an account removes the files stored for it (receipt archives hold a tenant's name, address
 * and amount). The user id becomes a path, so what is checked here is both halves: that the
 * account's folder goes and nobody else's does, and that nothing which is not shaped like an id, or
 * which would resolve outside the storage root, removes anything at all.
 */
describe("removeUserDocuments", () => {
  let base: string;
  let outside: string;
  let removeUserDocuments: typeof import("./document-service").removeUserDocuments;

  const store = (userId: string) => {
    const folder = path.join(base, userId, "receipt", "2026-10");
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "archive.pdf"), "%PDF");
    return path.join(base, userId);
  };

  beforeAll(async () => {
    const root = mkdtempSync(path.join(tmpdir(), "situs-docs-test-"));
    base = path.join(root, "documents");
    outside = path.join(root, "outside");
    mkdirSync(base, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "keep.txt"), "not a document");
    // Read once, when the module loads.
    process.env.DOCUMENT_STORAGE_PATH = base;
    vi.resetModules();
    ({ removeUserDocuments } = await import("./document-service"));
  });

  afterAll(() => {
    rmSync(path.dirname(base), { recursive: true, force: true });
  });

  it("removes the account's folder with everything in it", async () => {
    const mine = store("cmabc123");

    expect(await removeUserDocuments("cmabc123")).toBe(true);
    expect(existsSync(mine)).toBe(false);
  });

  it("leaves every other account's folder alone", async () => {
    store("cmmine");
    const theirs = store("cmtheirs");

    await removeUserDocuments("cmmine");

    expect(existsSync(theirs)).toBe(true);
  });

  it("is a success for an account that never stored a file", async () => {
    expect(await removeUserDocuments("cmnothing")).toBe(true);
  });

  it.each([
    ["an empty id", ""],
    ["the folder itself", "."],
    ["its parent", ".."],
    ["a path out of the root", "../outside"],
    ["a nested path", "cmabc/receipt"],
    ["an absolute path", "/etc"],
    ["a backslash path", "..\\outside"],
    ["an id with a space", "cm abc"],
    ["a very long id", "a".repeat(65)],
  ])("removes nothing for %s", async (_name, id) => {
    const canary = store("cmcanary");

    expect(await removeUserDocuments(id)).toBe(false);

    expect(existsSync(canary)).toBe(true);
    expect(existsSync(path.join(outside, "keep.txt"))).toBe(true);
    expect(existsSync(base)).toBe(true);
  });
});
