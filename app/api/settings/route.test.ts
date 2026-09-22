import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireAuthMock, isMockModeRef, findUniqueMock, upsertMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  isMockModeRef: { value: false },
  findUniqueMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({
  requireAuth: requireAuthMock,
}));

vi.mock("@/lib/config/data-mode", () => ({
  get isMockMode() {
    return isMockModeRef.value;
  },
}));

vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({
    userSettings: { findUnique: findUniqueMock, upsert: upsertMock },
  }),
}));

import { GET, POST } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/settings", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/settings — onboardingDismissedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMockModeRef.value = false;
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
  });

  it("GET returns onboardingDismissedAt as stored", async () => {
    findUniqueMock.mockResolvedValue({ userId: "user-123", onboardingDismissedAt: null });

    const response = await GET(new NextRequest("http://localhost:3000/api/settings"));
    const body = await response.json();

    expect(body.data.onboardingDismissedAt).toBeNull();
  });

  it("POST passes onboardingDismissedAt through to the upsert", async () => {
    upsertMock.mockResolvedValue({
      userId: "user-123",
      onboardingDismissedAt: "2026-07-09T00:00:00.000Z",
    });

    const response = await POST(postRequest({ onboardingDismissedAt: "2026-07-09T00:00:00.000Z" }));

    expect(response.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ onboardingDismissedAt: "2026-07-09T00:00:00.000Z" }),
        create: expect.objectContaining({ onboardingDismissedAt: "2026-07-09T00:00:00.000Z" }),
      }),
    );
  });
});
