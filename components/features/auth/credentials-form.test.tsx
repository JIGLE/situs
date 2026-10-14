// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { screen } from "@testing-library/react";

import { renderWithProviders as render } from "@/tests/helpers/render-with-providers";
import en from "@/messages/en.json";

vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));

import { CredentialsForm } from "./credentials-form";

/**
 * The form is in the server's HTML, and a browser can submit it before React attaches `onSubmit`.
 * It then submits it itself: with no `method` that is a GET, and the email and password go into
 * the URL. The mobile audit's sign-in did exactly that on 14 October 2026.
 */
describe("the email and password form", () => {
  it("is a POST with its button disabled in the server's HTML", () => {
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={en}>
        <CredentialsForm mode="signin" destination="/" />
      </NextIntlClientProvider>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");

    expect(doc.querySelector("form")?.getAttribute("method")).toBe("post");
    expect(doc.querySelector('form button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("enables its button once React is attached", () => {
    render(<CredentialsForm mode="signin" destination="/" />, { initialLocale: "en" });

    const button = screen.getByRole("button", { name: en.auth.signIn });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
