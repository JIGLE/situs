import { describe, it, expect } from "vitest";
import { receiptSchema, updateReceiptSchema } from "./receipt.schema";

describe("receipt schema", () => {
  it("still defaults a new receipt to paid", () => {
    const parsed = receiptSchema.parse({
      tenantId: "tenant-1",
      propertyId: "prop-1",
      amount: 950,
      date: "2026-03-01",
      type: "rent",
    });

    expect(parsed.status).toBe("paid");
  });

  // Zod 4 applies a `.default()` inside `.partial()`, so an update schema built that way turned
  // every edit that left `status` out into "mark as paid".
  it("adds nothing an update did not send", () => {
    expect(updateReceiptSchema.parse({ description: "Renda de março" })).toEqual({
      description: "Renda de março",
    });
  });
});
