// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import en from "@/messages/en.json";
import pt from "@/messages/pt.json";
import es from "@/messages/es.json";
import it_ from "@/messages/it.json";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));
vi.mock("next-auth/react", () => ({
  signIn: signInMock,
  useSession: () => ({ data: null, status: "unauthenticated" }),
}));
// The two controls have their own tests; this file is about the page around them.
vi.mock("@/components/shared/language-selector", () => ({ LanguageSelector: () => null }));
vi.mock("@/components/shared/theme-switcher", () => ({ ThemeSwitcher: () => null }));

import { AuthView, type AuthViewProps } from "./auth-view";

const catalogues = { en, pt, es, it: it_ } as const;
const LOCALES = ["en", "pt", "es", "it"] as const;

const view = (props: Partial<AuthViewProps> = {}) => (
  <AuthView
    mode="signin"
    demoLoginEnabled={false}
    signUpOpen={false}
    callbackUrl={null}
    {...props}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
  signInMock.mockResolvedValue(undefined);
});

describe("the sign-in page, as first rendered", () => {
  it.each(LOCALES)("shows the form at once in %s, with no loading screen", (locale) => {
    render(view(), { initialLocale: locale });

    const c = catalogues[locale].auth;
    expect(screen.getByRole("heading", { level: 1, name: c.signin.heading })).toBeDefined();
    expect(screen.getByRole("button", { name: c.signin.primary })).toBeDefined();
    expect(screen.queryByText(c.loading)).toBeNull();
  });

  it("has one main landmark and one h1", () => {
    render(view(), { initialLocale: "en" });

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it.each(LOCALES)("lists the three steps of the workflow in %s", (locale) => {
    render(view(), { initialLocale: locale });

    const c = catalogues[locale].auth;
    const list = screen.getByRole("list", { name: c.ledgerLabel });
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByText(c.brand.proof.bankLabel)).toBeDefined();
    expect(screen.getByText(c.brand.proof.receiptLabel)).toBeDefined();
    expect(screen.getByText(c.brand.proof.auditLabel)).toBeDefined();
    expect(screen.getByText(c.brand.tagline)).toBeDefined();
  });
});

describe("what a visitor with no account is told", () => {
  it.each(LOCALES)("says it is by invitation when sign-up is closed, in %s", (locale) => {
    render(view({ signUpOpen: false }), { initialLocale: locale });

    const c = catalogues[locale].auth;
    expect(screen.getByText(c.accessByInvitation)).toBeDefined();
    expect(screen.getByText(c.accessByInvitationNote)).toBeDefined();
    // Not a link that ends in a refusal.
    expect(screen.queryByText(c.signin.switchAction)).toBeNull();
    expect(document.querySelector('a[href="/auth/signup"]')).toBeNull();
  });

  it("offers to create an account when sign-up is open", () => {
    render(view({ signUpOpen: true }), { initialLocale: "pt" });

    const link = screen.getByRole("link", { name: pt.auth.signin.switchAction });
    expect(link.getAttribute("href")).toBe("/auth/signup");
    expect(screen.queryByText(pt.auth.accessByInvitation)).toBeNull();
  });

  it("offers the way back to sign-in on the sign-up page", () => {
    render(view({ mode: "signup", signUpOpen: true }), { initialLocale: "en" });

    const link = screen.getByRole("link", { name: en.auth.signup.switchAction });
    expect(link.getAttribute("href")).toBe("/auth/signin");
    expect(screen.getByRole("heading", { level: 1, name: en.auth.signup.heading })).toBeDefined();
  });
});

describe("the consent line", () => {
  it.each(LOCALES)("links the terms and the privacy notice in %s", (locale) => {
    render(view(), { initialLocale: locale });

    // The sentence reads whole (an ICU apostrophe before a tag, as in Italian's "l'<privacy>", would
    // swallow the tag and render it as text).
    expect(document.body.textContent).not.toMatch(/[<>]/);

    const legal = catalogues[locale].legal;
    expect(screen.getByRole("link", { name: legal.termsTitle }).getAttribute("href")).toBe(
      "/terms",
    );
    expect(screen.getByRole("link", { name: legal.privacyTitle }).getAttribute("href")).toBe(
      "/privacy",
    );
  });
});

describe("the way in", () => {
  it("goes to Google, to the dashboard unless the visitor was headed elsewhere", () => {
    render(view(), { initialLocale: "en" });

    fireEvent.click(screen.getByRole("button", { name: en.auth.signin.primary }));

    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/dashboard" });
  });

  it("carries the page the visitor was headed to", () => {
    render(view({ callbackUrl: "/financials?tab=tax" }), { initialLocale: "en" });

    fireEvent.click(screen.getByRole("button", { name: en.auth.signin.primary }));

    expect(signInMock).toHaveBeenCalledWith("google", { callbackUrl: "/financials?tab=tax" });
  });

  it("answers the tap at once: the button is busy and cannot be tapped twice", () => {
    signInMock.mockReturnValue(new Promise(() => {}));
    render(view(), { initialLocale: "en" });
    const button = screen.getByRole("button", { name: en.auth.signin.primary });

    fireEvent.click(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it("gives the button back when the browser restores the page from its cache", () => {
    signInMock.mockReturnValue(new Promise(() => {}));
    render(view(), { initialLocale: "en" });
    const button = screen.getByRole("button", { name: en.auth.signin.primary });
    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");

    const restored = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(restored, "persisted", { value: true });
    window.dispatchEvent(restored);

    return vi.waitFor(() => expect(button.getAttribute("aria-busy")).toBe("false"));
  });

  it("gives the button back when the sign-in call fails", async () => {
    signInMock.mockRejectedValue(new Error("offline"));
    render(view(), { initialLocale: "en" });
    const button = screen.getByRole("button", { name: en.auth.signin.primary });

    fireEvent.click(button);

    await vi.waitFor(() => expect(button.getAttribute("aria-busy")).toBe("false"));
  });
});

describe("the email and password form", () => {
  it("is there only on demo and self-hosted instances", () => {
    const { unmount } = render(view({ demoLoginEnabled: false }), { initialLocale: "en" });
    expect(document.querySelector('input[name="email"]')).toBeNull();
    unmount();

    render(view({ demoLoginEnabled: true }), { initialLocale: "en" });
    expect(document.querySelector('input[name="email"]')).not.toBeNull();
    expect(document.querySelector('input[name="password"]')).not.toBeNull();
    expect(document.querySelector('form button[type="submit"]')).not.toBeNull();
  });

  it("asks a phone for the email keyboard and a Go key, at a size that does not zoom the page", () => {
    render(view({ demoLoginEnabled: true }), { initialLocale: "en" });

    const email = document.querySelector('input[name="email"]') as HTMLInputElement;
    const password = document.querySelector('input[name="password"]') as HTMLInputElement;
    expect(email.getAttribute("inputmode")).toBe("email");
    expect(email.getAttribute("autocapitalize")).toBe("none");
    expect(password.getAttribute("enterkeyhint")).toBe("go");
    expect(email.className).toContain("text-base");
    expect(email.className).toContain("h-12");
  });

  it("signs in with the credentials and the same destination", () => {
    render(view({ demoLoginEnabled: true, callbackUrl: "/portfolio" }), { initialLocale: "en" });
    (document.querySelector('input[name="email"]') as HTMLInputElement).value = "a@b.pt";
    (document.querySelector('input[name="password"]') as HTMLInputElement).value = "secret";

    fireEvent.submit(document.querySelector("form") as HTMLFormElement);

    expect(signInMock).toHaveBeenCalledWith("credentials", {
      email: "a@b.pt",
      password: "secret",
      callbackUrl: "/portfolio",
    });
  });
});
