/**
 * @vitest-environment node
 *
 * The suite runs jsdom by default, which supplies its own `ArrayBuffer`. `file-type` checks the
 * input with an `instanceof`, so a buffer built in the jsdom realm is rejected as "object" even
 * though it is the right shape — a test-only artefact that would otherwise be mistaken for a
 * bug in the validation this file exists to prove. This module is server-only anyway: it uses
 * `fs`, `crypto` and `file-type`, none of which belong in a browser environment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { inboundAttachment: { aggregate: vi.fn() } },
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));

import {
  INBOUND_QUOTA_BYTES,
  MAX_ATTACHMENT_BYTES,
  inboundDir,
  storeAttachment,
} from "./attachments";
import type { NormalisedAttachment } from "./parse";

/** A real PNG: 8-byte signature, IHDR, IEND. `file-type` reads these bytes, not our word for it. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 0x0d]),
  Buffer.from("IHDR"),
  Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
  Buffer.from([0x1f, 0x15, 0xc4, 0x89]),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("IEND"),
  Buffer.from([0xae, 0x42, 0x60, 0x82]),
]);

let tmpDir: string;

function attachment(overrides: Partial<NormalisedAttachment> = {}): NormalisedAttachment {
  return {
    filename: "photo.png",
    declaredMimeType: "image/png",
    declaredSize: PNG.byteLength,
    downloadToken: "tok123",
    ...overrides,
  };
}

function respondWith(body: Buffer, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  })) as unknown as typeof fetch;
}

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "situs-inbound-"));
  process.env.UPLOADS_DIR = tmpDir;
  prismaMock.inboundAttachment.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
});

afterEach(async () => {
  delete process.env.UPLOADS_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("storeAttachment", () => {
  it("stores a file whose bytes match an allowed type", async () => {
    const stored = await storeAttachment("msg-1", "user-1", attachment(), {
      apiKey: "k",
      fetchImpl: respondWith(PNG),
    });

    expect(stored).toMatchObject({ mimeType: "image/png", fileSize: PNG.byteLength });
    expect(await fs.readFile(stored!.storagePath)).toEqual(PNG);
  });

  /**
   * The rule the whole module exists for: the sender says what the file is, and the sender is
   * not to be believed. A .png Content-Type over HTML bytes is the classic stored-XSS delivery.
   */
  it("rejects a file whose bytes disagree with the type the sender declared", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const stored = await storeAttachment("msg-1", "user-1", attachment(), {
      apiKey: "k",
      fetchImpl: respondWith(html),
    });
    expect(stored).toBeNull();
  });

  it("rejects a real file of a type not on the allowlist", async () => {
    // A ZIP is a valid file with valid magic bytes. Valid is not the same as permitted — this
    // endpoint is reachable by anyone who learns the address.
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]);
    const stored = await storeAttachment("msg-1", "user-1", attachment(), {
      apiKey: "k",
      fetchImpl: respondWith(zip),
    });
    expect(stored).toBeNull();
  });

  it("names the stored file from the detected type, never from the sender's filename", async () => {
    const stored = await storeAttachment(
      "msg-1",
      "user-1",
      attachment({ filename: "../../../etc/passwd" }),
      { apiKey: "k", fetchImpl: respondWith(PNG) },
    );

    // The label survives for display; the path does not inherit it.
    expect(stored!.filename).toBe("../../../etc/passwd");
    expect(stored!.storagePath.endsWith(".png")).toBe(true);
    expect(path.dirname(stored!.storagePath)).toBe(inboundDir("msg-1"));
    expect(stored!.storagePath).not.toContain("passwd");
  });

  it("drops an attachment larger than the cap", async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
    const stored = await storeAttachment("msg-1", "user-1", attachment(), {
      apiKey: "k",
      fetchImpl: respondWith(huge),
    });
    expect(stored).toBeNull();
  });

  it("refuses to write past the account's inbound quota", async () => {
    prismaMock.inboundAttachment.aggregate.mockResolvedValue({
      _sum: { fileSize: INBOUND_QUOTA_BYTES },
    });
    const stored = await storeAttachment("msg-1", "user-1", attachment(), {
      apiKey: "k",
      fetchImpl: respondWith(PNG),
    });
    expect(stored).toBeNull();
  });

  it("returns null rather than throwing when the download fails", async () => {
    // A failed attachment must cost the attachment, never the message it came with.
    expect(
      await storeAttachment("msg-1", "user-1", attachment(), {
        apiKey: "k",
        fetchImpl: respondWith(Buffer.alloc(0), false, 404),
      }),
    ).toBeNull();

    expect(
      await storeAttachment("msg-1", "user-1", attachment(), {
        apiKey: "k",
        fetchImpl: vi.fn(async () => {
          throw new Error("network");
        }) as unknown as typeof fetch,
      }),
    ).toBeNull();
  });

  it("does nothing at all without an API key", async () => {
    const fetchImpl = respondWith(PNG);
    expect(
      await storeAttachment("msg-1", "user-1", attachment(), { apiKey: "", fetchImpl }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the token as a path segment of Brevo's own URL", async () => {
    const fetchImpl = respondWith(PNG);
    await storeAttachment("msg-1", "user-1", attachment({ downloadToken: "abc" }), {
      apiKey: "k",
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/inbound/attachments/abc",
      expect.objectContaining({ headers: expect.objectContaining({ "api-key": "k" }) }),
    );
  });
});
