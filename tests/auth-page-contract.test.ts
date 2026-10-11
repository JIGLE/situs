import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The sign-in page is drawn by the server, in one pass.
 *
 * It used to be a client component behind `useSession()`: the server sent a spinner and the form
 * appeared once the script loaded and the session request came back, so a cold launch of the
 * installed app showed its splash and then a second loading screen, and with scripts slow or
 * blocked there was no form at all. These read the source for the shape that prevents it; the
 * end-to-end spec reads the real response.
 */
const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("the sign-in view", () => {
  const view = read("components/features/auth/auth-view.tsx");

  it("is a server component, with no session wait and no loading screen of its own", () => {
    expect(view).not.toMatch(/^["']use client["']/m);
    expect(view).not.toMatch(/useSession|useSearchParams|useRouter/);
    expect(view).not.toMatch(/status === ["']loading["']/);
    expect(view).not.toMatch(/Suspense/);
  });

  it("is one main landmark with one h1", () => {
    expect(view.match(/<main\b/g)).toHaveLength(1);
    expect(view.match(/<h1\b/g)).toHaveLength(1);
  });

  it("fills the visible screen, not the largest one", () => {
    expect(view).toMatch(/min-h-dvh/);
    expect(view).not.toMatch(/min-h-screen|h-screen/);
  });

  it("is told what it needs rather than discovering it", () => {
    expect(view).toMatch(/signUpOpen: boolean/);
    expect(view).toMatch(/callbackUrl: string \| null/);
  });
});

describe("the server half", () => {
  const server = read("app/auth/render-auth.tsx");

  it("is what both pages render", () => {
    expect(read("app/auth/signin/page.tsx")).toMatch(/renderAuthPage\("signin"/);
    expect(read("app/auth/signup/page.tsx")).toMatch(/renderAuthPage\("signup"/);
    expect(read("app/auth/signin/page.tsx")).not.toMatch(/<AuthView/);
    expect(read("app/auth/signup/page.tsx")).not.toMatch(/<AuthView/);
  });

  it("redirects outside the try, because redirect() works by throwing", () => {
    const tried = server.slice(server.indexOf("try {"), server.indexOf("} catch"));

    expect(tried).toContain("getServerSession");
    expect(tried).not.toMatch(/redirect\(/);
    expect(server).toMatch(/if \(signedIn\) redirect\(/);
  });

  it("checks the callbackUrl once, with the shared guard", () => {
    expect(server).toMatch(/safeCallbackUrl\(/);
    expect(read("lib/utils/safe-callback-url.ts")).toMatch(/startsWith\("\/\/"\)/);
  });

  it("answers a closed instance's sign-up page with the sign-in page", () => {
    expect(server).toMatch(/mode === "signup" && !signUpOpen/);
  });
});
