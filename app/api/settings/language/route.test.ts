import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `PUT /api/settings/language` records the owner's choice: the language, and when they chose it.
 * The date is what lets a new device adopt it at sign-in, so it is written here and only here.
 */

const { requireAuthMock, upsertMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/lib/services/auth/auth-middleware", () => ({ requireAuth: requireAuthMock }));
vi.mock("@/lib/config/data-mode", () => ({ isMockMode: false }));
vi.mock("@/lib/services/database/database", () => ({
  getPrismaClient: () => ({ userSettings: { upsert: upsertMock } }),
}));

import { PUT } from "./route";

const put = (body: string) =>
  PUT(
    new NextRequest("http://localhost:3000/api/settings/language", {
      method: "PUT",
      body,
      headers: { "Content-Type": "application/json" },
    }),
  );

describe("PUT /api/settings/language", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({ userId: "user-1" });
    upsertMock.mockImplementation(async ({ update }) => update);
  });

  it("saves the language with the moment it was chosen, for the caller only", async () => {
    const res = await put(JSON.stringify({ language: "en" }));

    expect(res.status).toBe(200);
    const [args] = upsertMock.mock.calls[0];
    expect(args.where).toEqual({ userId: "user-1" });
    expect(args.update.language).toBe("en");
    expect(args.update.languageChosenAt).toBeInstanceOf(Date);
    expect(args.create).toMatchObject({ userId: "user-1", language: "en" });
    expect(args.create.languageChosenAt).toBeInstanceOf(Date);
    expect((await res.json()).data.language).toBe("en");
  });

  it.each([
    ["a language the app does not have", JSON.stringify({ language: "fr" })],
    ["no language at all", JSON.stringify({})],
    ["a body that is not JSON", "{language: en"],
  ])("answers 400 for %s, and saves nothing", async (_case, body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("answers the auth refusal without touching the database", async () => {
    requireAuthMock.mockResolvedValue(new Response(null, { status: 401 }));

    expect((await put(JSON.stringify({ language: "en" }))).status).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
