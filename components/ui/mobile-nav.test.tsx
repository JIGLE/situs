import { describe, it, expect, vi } from "vitest";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";
import { MobileBottomNav, MobileTopBar } from "./mobile-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));
vi.mock("@/lib/contexts/portal-context", () => ({
  usePortalAccess: () => ({
    navigation: [],
    mobilePrimaryNavigation: [],
    mobileSecondaryNavigation: [],
  }),
}));
// Both fetch or need their own providers; neither is what this file is about.
vi.mock("@/components/shared/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/shared/language-selector", () => ({ LanguageSelector: () => null }));

// Landmark and link labels are announced, not seen, so a hardcoded English one survives every
// visual check. Portuguese is asserted because English would pass with the string hardcoded.
describe("mobile navigation labels", () => {
  it("names the bottom bar in the app's language", () => {
    renderWithProviders(<MobileBottomNav />, { initialLocale: "pt" });

    expect(screen.getByRole("navigation", { name: "Navegação móvel" })).toBeDefined();
  });

  it("names the top bar's home link in the app's language", () => {
    renderWithProviders(<MobileTopBar />, { initialLocale: "pt" });

    expect(screen.getByRole("link", { name: "Situs — Início" })).toBeDefined();
  });
});
