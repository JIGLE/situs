/**
 * A real NextAuth session, for tests that run `proxy.ts`.
 *
 * The proxy loads `getToken` with `require`, which `vi.mock("next-auth/jwt")` does not reach: a
 * mocked `getToken` is never called, and the real one answers. A mock that returns a session
 * therefore changes nothing, and a test that believed it was signed in was not. A signed-in request
 * has to carry a real session token, encoded with the library's own `encode` under the secret the
 * test puts in `NEXTAUTH_SECRET`:
 *
 *   beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", TEST_NEXTAUTH_SECRET));
 *   afterEach(() => vi.unstubAllEnvs());
 *
 * Such a test runs in the node environment (`// @vitest-environment node`): under jsdom, `encode`
 * fails because the `Uint8Array` it is handed is not the one jose checks for.
 */
export const TEST_NEXTAUTH_SECRET = "proxy-test-secret-0123456789-abcdefghij";

/**
 * Headers that sign a request in. `getToken` reads a bearer token as well as the session cookie
 * and decodes both the same way; the header keeps a test independent of which cookie name
 * `NEXTAUTH_URL` selects.
 */
export async function signedInHeaders(): Promise<Record<string, string>> {
  // Loaded the way proxy.ts loads `getToken`, and typed by hand for the reason it gives: the
  // package's typings do not resolve under this project's module resolution.
  const { encode } = require("next-auth/jwt") as {
    encode: (params: { token: Record<string, unknown>; secret: string }) => Promise<string>;
  };
  const token = await encode({
    token: { sub: "user-1", email: "owner@example.test" },
    secret: TEST_NEXTAUTH_SECRET,
  });
  return { authorization: `Bearer ${token}` };
}
