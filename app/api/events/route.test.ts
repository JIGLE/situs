import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAuthMock, recordProductEventMock, isMockModeRef } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  recordProductEventMock: vi.fn(),
  isMockModeRef: { value: false },
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
  handleOptions: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/config/data-mode", () => ({
  get isMockMode() {
    return isMockModeRef.value;
  },
}));

vi.mock("@/lib/services/analytics/product-events", () => ({
  recordProductEvent: recordProductEventMock,
  PRODUCT_EVENT_NAMES: ["reminder_clicked"],
}));

import { POST } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMockModeRef.value = false;
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
  });

  it("records a valid event for an authenticated user", async () => {
    const response = await POST(
      postRequest({ name: "reminder_clicked", metadata: { type: "payment_due" } }),
    );

    expect(response.status).toBe(200);
    expect(recordProductEventMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-123",
      "reminder_clicked",
      { type: "payment_due" },
    );
  });

  it("rejects an unrecognized event name as a 400, not a 500", async () => {
    const response = await POST(postRequest({ name: "totally_made_up_event" }));

    // Previously this asserted only >= 400 and passed against a 500: the route called
    // eventSchema.parse() directly, so the ZodError reached withErrorHandler, which has no
    // ZodError branch and defaults to 500. A bad payload is the caller's fault, not ours.
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ error: expect.stringContaining("Validation error") }),
    );
    expect(recordProductEventMock).not.toHaveBeenCalled();
  });

  it("is a no-op in mock mode", async () => {
    isMockModeRef.value = true;

    const response = await POST(postRequest({ name: "reminder_clicked" }));

    expect(response.status).toBe(200);
    expect(recordProductEventMock).not.toHaveBeenCalled();
  });
});
