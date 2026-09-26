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
    ["a dismissal date that is not a date", { onboardingDismissedAt: "yesterday" }],
    ["a theme that is not a string", { theme: 42 }],
  ])("answers 400 for %s and writes nothing", async (_label, body) => {
    const response = await POST(postRequest(body));

    expect(response.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("saves one field without touching the others (the onboarding checklist sends only one)", async () => {
    const response = await POST(postRequest({ distributionNotifications: false }));

    expect(response.status).toBe(200);
    const { update } = upsertMock.mock.calls[0][0];
    expect(update.distributionNotifications).toBe(false);
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
    expect(update).toMatchObject({ theme: "light", emailNotifications: false });
    expect(update).not.toHaveProperty("id");
    expect(update).not.toHaveProperty("userId");
  });

  it("leaves the language to its own route, whatever the row holds", async () => {
    // The row posted back holds the language it loaded, which may be the old default. Writing it
    // here would record a default as the owner's choice; `PUT /api/settings/language` records
    // choices.
    await POST(postRequest({ language: "en", emailNotifications: true }));

    const { update, create } = upsertMock.mock.calls[0][0];
    expect(update.language).toBeUndefined();
    expect(update.languageChosenAt).toBeUndefined();
    expect(create.language).toBeUndefined();
  });

  it("saves the country of residence as an ISO code", async () => {
    const response = await POST(postRequest({ residenceCountry: "es" }));

    expect(response.status).toBe(200);
    expect(upsertMock.mock.calls[0][0].update.residenceCountry).toBe("ES");
  });

  it("answers 400 for a country that does not exist, and saves nothing", async () => {
    const response = await POST(postRequest({ residenceCountry: "XX" }));

    expect(response.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
