/**
 * The app shell's own words — skip links and landmark labels — are the first thing a screen reader
 * announces on every page, and both layouts hardcoded them in English. This asserts Portuguese,
 * for the reason `i18n-no-hardcoded-copy.test.tsx` gives: asserting English cannot catch a
 * component that hardcodes English.
 *
 * The layouts are async server components. `getTranslations` is pointed at the Portuguese
 * catalogue, and the children the shell composes — each with its own tests — are stubbed, so what
 * renders here is the shell alone.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";
import ptMessages from "@/messages/pt.json";
import { renderWithProviders, screen } from "@/tests/helpers/render-with-providers";

// A plain lookup over the Portuguese catalogue: these keys take no arguments, and a missing key
// returns the key itself, which fails the assertions below just as surely.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof ptMessages) => {
    const catalogue = ptMessages[namespace] as Record<string, string>;
    return (key: string) => catalogue[key] ?? key;
  },
}));

// Hoisted with the mocks that use it; plain return, because JSX is not available that early.
const { passThrough } = vi.hoisted(() => ({
  passThrough: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/layouts/sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/ui/mobile-nav", () => ({
  MobileTopBar: () => null,
  MobileBottomNav: () => null,
}));
vi.mock("@/components/shared/breadcrumbs", () => ({ Breadcrumbs: () => null }));
vi.mock("@/components/shared/entity-detail-route-client", () => ({
  EntityDetailRouteClient: () => null,
}));
vi.mock("@/components/shared/portal-access-guard", () => ({ PortalAccessGuard: passThrough }));
vi.mock("@/components/shared/app-data-gate", () => ({ AppDataGate: passThrough }));
vi.mock("@/components/features/admin/admin-shell-nav", () => ({ AdminShellNav: () => null }));

import MainLayout from "@/app/[locale]/(main)/layout";
import AdminLayout from "@/app/[locale]/(admin)/layout";

describe("app shell copy", () => {
  it("renders the main layout's skip links and sidebar landmark in Portuguese", async () => {
    renderWithProviders(await MainLayout({ children: <p>conteúdo</p> }), { initialLocale: "pt" });

    expect(screen.getByRole("link", { name: "Saltar para o conteúdo principal" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Saltar para a navegação" })).toBeDefined();
    expect(screen.getByRole("complementary", { name: "Navegação lateral" })).toBeDefined();
  });

  it("renders the admin layout's skip link in Portuguese", async () => {
    renderWithProviders(await AdminLayout({ children: <p>conteúdo</p> }), { initialLocale: "pt" });

    expect(screen.getByRole("link", { name: "Saltar para o conteúdo principal" })).toBeDefined();
  });
});
