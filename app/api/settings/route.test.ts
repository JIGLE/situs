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

describe("POST /api/settings validates what it writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMockModeRef.value = false;
    requireAuthMock.mockResolvedValue({ userId: "user-123" });
    upsertMock.mockResolvedValue({ userId: "user-123" });
  });

  it.each([
    ["a flag that is not a boolean", { emailNotifications: "yes" }],
    ["a currency the column cannot hold", { defaultCurrency: "BTC" }],
    ["a dismissal date that is not a date", { onboardingDismissedAt: "yesterday" }],
    ["a theme that is not a string", { theme: 42 }],
  ])("answers 400 for %s and writes nothing", async (_label, body) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("saves one field without touching the others (the currency switcher sends only this)", async () => {
    const response = await POST(postRequest({ defaultCurrency: "GBP" }));

    expect(response.status).toBe(200);
    const { update } = upsertMock.mock.calls[0][0];
    expect(update.defaultCurrency).toBe("GBP");
    expect(update.emailNotifications).toBeUndefined();
    expect(update.theme).toBeUndefined();
  });

  it("accepts the whole row the settings form loaded, including an older theme name", async () => {
    // The settings form posts back what GET returned, edits merged in: the row's own keys and
    // whatever theme an older version stored ("light" and "dark-oled" predate "normal").
    const row = {
      id: "settings-1",
      userId: "user-123",
      theme: "light",
      language: "pt",
      defaultCurrency: "EUR",
      defaultTaxCountry: null,
      emailNotifications: false,
      taxReminderNotifications: true,
      distributionNotifications: true,
      onboardingDismissedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };

    const response = await POST(postRequest(row));

    expect(response.status).toBe(200);
    const { update } = upsertMock.mock.calls[0][0];
    expect(update).toMatchObject({ theme: "light", language: "pt", emailNotifications: false });
    expect(update).not.toHaveProperty("id");
    expect(update).not.toHaveProperty("userId");
  });
});
