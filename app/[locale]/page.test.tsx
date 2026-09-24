import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const getServerSession = vi.hoisted(() => vi.fn());

vi.mock("next-auth/next", () => ({ getServerSession }));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));

import RootPage from "./page";

describe("the root page at /", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Next's redirect() works by throwing. The global stub in tests/setup.ts returns instead,
    // which is exactly what hid this: a catch around it swallowed nothing in a test.
    vi.mocked(redirect).mockImplementation((url: string) => {
      throw Object.assign(new Error("NEXT_REDIRECT"), {
        digest: `NEXT_REDIRECT;replace;${url};307;`,
      });
    });
  });

  it("sends a signed-in visitor to the dashboard", async () => {
    getServerSession.mockResolvedValue({ user: { id: "u1", email: "owner@example.com" } });

    await expect(RootPage()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("sends a signed-out visitor to sign-in", async () => {
    getServerSession.mockResolvedValue(null);

    await expect(RootPage()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/auth/signin");
  });

  it("sends a visitor to sign-in when the session cannot be read", async () => {
    getServerSession.mockRejectedValue(new Error("database unavailable"));

    await expect(RootPage()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/auth/signin");
  });
});
