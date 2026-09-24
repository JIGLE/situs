import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement } from "react";
import { redirect } from "next/navigation";

const getServerSession = vi.hoisted(() => vi.fn());

vi.mock("next-auth/next", () => ({ getServerSession }));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/components/shared/landing-analytics", () => ({ LandingAnalyticsObserver: () => null }));
vi.mock("@/components/shared/landing-hero-sequence", () => ({ LandingHeroSequence: () => null }));
vi.mock("@/components/shared/locale-select-overlay", () => ({ LocaleSelectOverlay: () => null }));
vi.mock("@/components/shared/pwa-welcome", () => ({ PwaWelcome: () => null }));

import LandingPage from "./page";

const params = Promise.resolve({ locale: "pt" });

describe("the landing page at /", () => {
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

    await expect(LandingPage({ params })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("shows the landing page to a signed-out visitor", async () => {
    getServerSession.mockResolvedValue(null);

    expect(isValidElement(await LandingPage({ params }))).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("still shows the landing page when the session cannot be read", async () => {
    getServerSession.mockRejectedValue(new Error("database unavailable"));

    expect(isValidElement(await LandingPage({ params }))).toBe(true);
    expect(redirect).not.toHaveBeenCalled();
  });
});
