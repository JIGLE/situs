import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server half of the sign-in and sign-up pages: who is sent on without seeing the form, where,
 * and what the page is told. `redirect()` works by throwing, so the mock throws a marker the tests
 * read; the session, the sign-up answer and the demo flag are stubbed.
 */
const { sessionMock, signUpOpenMock, demoMock } = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  signUpOpenMock: vi.fn(),
  demoMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next-auth/next", () => ({ getServerSession: sessionMock }));
vi.mock("@/lib/services/auth/auth", () => ({ getAuthOptions: () => ({}) }));
vi.mock("@/lib/services/auth/sign-up", () => ({ isSignUpOpen: signUpOpenMock }));
vi.mock("@/lib/utils/demo-login", () => ({ isDemoLoginEnabled: demoMock }));

import { renderAuthPage } from "./render-auth";

const params = (value: Record<string, string | string[] | undefined> = {}) =>
  Promise.resolve(value);
const redirectOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message.replace("REDIRECT ", "");
  }
  return null;
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue(null);
  signUpOpenMock.mockResolvedValue(false);
  demoMock.mockReturnValue(false);
});

describe("a visitor who is already signed in", () => {
  beforeEach(() => sessionMock.mockResolvedValue({ user: { id: "u1" } }));

  it("goes to the dashboard without seeing the form", async () => {
    expect(await redirectOf(renderAuthPage("signin", params()))).toBe("/dashboard");
  });

  it("goes where they were headed", async () => {
    expect(
      await redirectOf(renderAuthPage("signin", params({ callbackUrl: "/financials?tab=tax" }))),
    ).toBe("/financials?tab=tax");
  });

  it("is not sent to another site by a callbackUrl", async () => {
    for (const evil of ["https://evil.example/", "//evil.example", "/\\evil.example"]) {
      expect(await redirectOf(renderAuthPage("signin", params({ callbackUrl: evil })))).toBe(
        "/dashboard",
      );
    }
  });

  it("goes to the code page when only the first factor passed", async () => {
    sessionMock.mockResolvedValue({ user: { id: "u1" }, mfaPending: true });

    expect(await redirectOf(renderAuthPage("signin", params({ callbackUrl: "/portfolio" })))).toBe(
      "/auth/mfa",
    );
  });

  it("is sent on from the sign-up page too", async () => {
    expect(await redirectOf(renderAuthPage("signup", params()))).toBe("/dashboard");
  });
});

describe("a visitor who is not signed in", () => {
  it("is shown the form, with what the page needs", async () => {
    signUpOpenMock.mockResolvedValue(true);
    demoMock.mockReturnValue(true);

    const element = (await renderAuthPage("signin", params({ callbackUrl: "/portfolio" }))) as {
      props: Record<string, unknown>;
    };

    expect(element.props).toMatchObject({
      mode: "signin",
      demoLoginEnabled: true,
      signUpOpen: true,
      callbackUrl: "/portfolio",
    });
  });

  it("is given no destination when the callbackUrl is not a same-site path", async () => {
    const element = (await renderAuthPage(
      "signin",
      params({ callbackUrl: "https://evil.example" }),
    )) as {
      props: Record<string, unknown>;
    };

    expect(element.props.callbackUrl).toBeNull();
  });

  it("takes the first of a repeated callbackUrl", async () => {
    const element = (await renderAuthPage("signin", params({ callbackUrl: ["/a", "/b"] }))) as {
      props: Record<string, unknown>;
    };

    expect(element.props.callbackUrl).toBe("/a");
  });

  it("is shown the form when the session cannot be read", async () => {
    sessionMock.mockRejectedValue(new Error("secret missing"));

    const element = (await renderAuthPage("signin", params())) as {
      props: Record<string, unknown>;
    };

    expect(element.props.mode).toBe("signin");
  });

  it("is told sign-up is closed when it is", async () => {
    const element = (await renderAuthPage("signin", params())) as {
      props: Record<string, unknown>;
    };

    expect(element.props.signUpOpen).toBe(false);
  });
});

describe("the sign-up page", () => {
  it("is shown when sign-up is open", async () => {
    signUpOpenMock.mockResolvedValue(true);

    const element = (await renderAuthPage("signup", params())) as {
      props: Record<string, unknown>;
    };

    expect(element.props).toMatchObject({ mode: "signup", signUpOpen: true });
  });

  it("goes to sign-in on a closed instance, keeping where the visitor was headed", async () => {
    signUpOpenMock.mockResolvedValue(false);

    expect(await redirectOf(renderAuthPage("signup", params()))).toBe("/auth/signin");
    expect(
      await redirectOf(renderAuthPage("signup", params({ callbackUrl: "/portfolio?a=1" }))),
    ).toBe("/auth/signin?callbackUrl=%2Fportfolio%3Fa%3D1");
  });
});
