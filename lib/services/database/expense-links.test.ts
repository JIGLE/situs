import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An expense's lease and evidence document came from the body and were written as sent: only its
 * property was checked. So an expense could name another account's lease or document, or a lease
 * on a different property than the one it is booked against.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    property: { findFirst: vi.fn() },
    lease: { findFirst: vi.fn() },
    document: { findFirst: vi.fn() },
  },
}));
vi.mock("./database", () => ({ getPrismaClient: () => prismaMock }));

import { assertExpenseLinks } from "./expense-links";
import { ResourceNotFoundError, ValidationError } from "@/lib/utils/error-handling";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.property.findFirst.mockResolvedValue({ id: "prop-1" });
  prismaMock.lease.findFirst.mockResolvedValue({ propertyId: "prop-1" });
  prismaMock.document.findFirst.mockResolvedValue({ id: "doc-1" });
});

describe("assertExpenseLinks", () => {
  it("accepts the caller's own property, lease on it, and document", async () => {
    await expect(
      assertExpenseLinks("user-1", {
        propertyId: "prop-1",
        leaseId: "lease-1",
        documentId: "doc-1",
      }),
    ).resolves.toBeUndefined();
    expect(prismaMock.lease.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lease-1", userId: "user-1" } }),
    );
    expect(prismaMock.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "doc-1", userId: "user-1" } }),
    );
  });

  it("refuses a lease that is not the caller's", async () => {
    prismaMock.lease.findFirst.mockResolvedValue(null);
    await expect(
      assertExpenseLinks("user-1", { propertyId: "prop-1", leaseId: "theirs" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("refuses a lease on another property", async () => {
    prismaMock.lease.findFirst.mockResolvedValue({ propertyId: "prop-2" });
    await expect(
      assertExpenseLinks("user-1", { propertyId: "prop-1", leaseId: "lease-2" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a document that is not the caller's", async () => {
    prismaMock.document.findFirst.mockResolvedValue(null);
    await expect(
      assertExpenseLinks("user-1", { propertyId: "prop-1", documentId: "theirs" }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });

  it("checks nothing more when no lease or document is named", async () => {
    await assertExpenseLinks("user-1", { propertyId: "prop-1", leaseId: null, documentId: null });
    expect(prismaMock.lease.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.document.findFirst).not.toHaveBeenCalled();
  });
});
