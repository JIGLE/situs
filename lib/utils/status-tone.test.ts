import { describe, expect, it } from "vitest";

import {
  connectionStatus,
  leaseEndStatus,
  leaseStatus,
  movementStatus,
  paymentStatus,
  propertyStatus,
  receiptStage,
  severityStatus,
} from "./status-tone";

/**
 * One table per kind of state. A lease was grey in the list and red on its own page; asking the
 * same function from both screens is what keeps them agreeing.
 */
describe("status tones", () => {
  it("gives a lease one tone wherever it is shown", () => {
    expect(leaseStatus("active").tone).toBe("success");
    expect(leaseStatus("expired").tone).toBe("danger");
    expect(leaseStatus("terminated").tone).toBe("neutral");
    expect(leaseStatus("pending").tone).toBe("info");
  });

  it("reads a tenant's standing and a receipt's money state the same way", () => {
    expect(paymentStatus("paid").tone).toBe("success");
    expect(paymentStatus("pending").tone).toBe("warning");
    expect(paymentStatus("overdue").tone).toBe("danger");
  });

  it("strikes through a state that no longer counts", () => {
    expect(receiptStage("voided")).toEqual({ tone: "neutral", struck: true });
    expect(movementStatus("duplicate")).toEqual({ tone: "neutral", struck: true });
    expect(movementStatus("ignored").struck).toBeUndefined();
  });

  it("covers the rest of the stored states", () => {
    expect(propertyStatus("maintenance").tone).toBe("warning");
    expect(receiptStage("rejected").tone).toBe("danger");
    expect(movementStatus("needs_review").tone).toBe("warning");
    expect(connectionStatus("revoked").tone).toBe("neutral");
    expect(connectionStatus("error").tone).toBe("danger");
    expect(severityStatus("simulated").tone).toBe("info");
  });

  it("shows a state it does not know as a plain mark, not a missing one", () => {
    expect(leaseStatus("something_new")).toEqual({ tone: "neutral" });
    expect(paymentStatus(undefined)).toEqual({ tone: "neutral" });
  });

  it("warns inside 60 days of a lease's end and calls it urgent inside 30", () => {
    expect(leaseEndStatus(90).tone).toBe("success");
    expect(leaseEndStatus(60).tone).toBe("warning");
    expect(leaseEndStatus(30).tone).toBe("danger");
  });
});
