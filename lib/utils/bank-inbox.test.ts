// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  INBOX_FILTERS,
  INBOX_FILTER_COUNT,
  INBOX_FILTER_QUERY,
  daysUntil,
  formatMovementAmount,
  isInboxFilter,
} from "./bank-inbox";

describe("formatMovementAmount", () => {
  it("writes euros as the rest of the app does", () => {
    expect(formatMovementAmount(850, "EUR")).toBe("€850,00");
  });

  it("marks money going out with a minus before the sign", () => {
    expect(formatMovementAmount(-42.5, "EUR")).toBe("−€42,50");
  });

  it("shows another currency by its code rather than as euros", () => {
    expect(formatMovementAmount(100, "USD")).toBe("100,00 USD");
  });
});

describe("the inbox filters", () => {
  it("open on money in waiting for review, and keep money out apart", () => {
    expect(INBOX_FILTERS[0]).toBe("review");
    expect(INBOX_FILTER_QUERY.review).toBe("?status=needs_review&direction=in");
    expect(INBOX_FILTER_QUERY.outgoing).toBe("?status=needs_review&direction=out");
    expect(INBOX_FILTER_COUNT.review).toBe("toReview");
  });

  it("recognise only their own names", () => {
    expect(isInboxFilter("outgoing")).toBe(true);
    expect(isInboxFilter("needs_review")).toBe(false);
  });
});

describe("daysUntil", () => {
  const NOW = new Date("2026-09-25T12:00:00Z");

  it("counts whole days ahead, rounding up", () => {
    expect(daysUntil("2026-10-05T00:00:00Z", NOW)).toBe(10);
  });

  it("goes negative once the date has passed", () => {
    expect(daysUntil("2026-09-20T00:00:00Z", NOW)).toBeLessThan(0);
  });
});
