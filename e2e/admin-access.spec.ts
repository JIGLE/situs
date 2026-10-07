import { test, expect, type APIRequestContext } from "@playwright/test";

test.use({ storageState: "playwright/.auth/user.json" });

/**
 * Who may create an account and who has one: the two sign-up switches, the invitations and the
 * accounts' roles, as the administrator the suite signs in as reaches them.
 *
 * The unit tests mock the database. This goes through the real routes, the CSRF check and SQLite, and
 * reads back what was stored; it is also where the two tables these routes use are shown to exist in
 * the database CI pushes before it boots the app.
 *
 * Every test puts back what it changed. The gate reads the switches for anyone who signs in as a
 * stranger, and the whole suite shares one database.
 */

const STAMP = Date.now();
const BASE = "/api/admin/access";

type Settings = { googleSignUp: boolean; invitations: boolean };
type Invitation = {
  id: string;
  email: string;
  role: "ADMIN" | "MANAGER";
  expiresAt: string;
  expired: boolean;
};
type Account = { id: string; email: string; role: "ADMIN" | "MANAGER" | "USER"; self: boolean };
type Access = {
  settings: Settings;
  invitations: Invitation[];
  allowlist: string[];
  accounts: Account[];
};

/** State-changing routes are CSRF-guarded with a double-submit cookie. */
async function csrfHeader(request: APIRequestContext): Promise<Record<string, string>> {
  await request.get("/api/csrf-token");
  const { cookies } = await request.storageState();
  const token = cookies.find((c) => c.name === "csrf-token")?.value;
  expect(token, "no csrf-token cookie after GET /api/csrf-token").toBeTruthy();
  return { "x-csrf-token": token as string };
}

async function getAccess(request: APIRequestContext): Promise<Access> {
  const res = await request.get(BASE);
  expect(res.ok(), `GET ${BASE} → ${res.status()}: ${await res.text()}`).toBe(true);
  return (await res.json()).data as Access;
}

async function send<T>(
  request: APIRequestContext,
  method: "put" | "post",
  url: string,
  data: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const res = await request[method](url, { data, headers });
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()}: ${await res.text()}`).toBe(
    true,
  );
  return (await res.json()).data as T;
}

test.describe.configure({ mode: "serial" });

test("serves the switches, the invitations, the allowlist and the accounts", async ({
  request,
}) => {
  const access = await getAccess(request);

  expect(typeof access.settings.googleSignUp).toBe("boolean");
  expect(typeof access.settings.invitations).toBe("boolean");
  expect(Array.isArray(access.invitations)).toBe(true);
  expect(Array.isArray(access.allowlist)).toBe(true);
  // The account the suite is signed in as is listed, marked as the reader's own, and is an administrator.
  const own = access.accounts.filter((account) => account.self);
  expect(own).toHaveLength(1);
  expect(own[0].role).toBe("ADMIN");
});

test("changes a switch, keeps it, and puts it back", async ({ request }) => {
  const headers = await csrfHeader(request);
  const before = (await getAccess(request)).settings;

  try {
    const after = await send<Settings>(
      request,
      "put",
      `${BASE}/settings`,
      { googleSignUp: !before.googleSignUp },
      headers,
    );

    // Only the switch asked about changed, and what was stored is what the listing now says.
    expect(after).toEqual({ ...before, googleSignUp: !before.googleSignUp });
    expect((await getAccess(request)).settings).toEqual(after);
  } finally {
    await send<Settings>(request, "put", `${BASE}/settings`, before, headers);
  }

  expect((await getAccess(request)).settings).toEqual(before);
});

test("invites an email, renews the invitation when it is sent again, and withdraws it", async ({
  request,
}, testInfo) => {
  const headers = await csrfHeader(request);
  const email = `guest-${STAMP}-${testInfo.project.name}@example.test`;
  let id: string | undefined;

  try {
    // Typed in capitals with stray spaces: it is stored as the address it is.
    const made = await send<Invitation>(
      request,
      "post",
      `${BASE}/invitations`,
      { email: `  ${email.toUpperCase()} `, role: "MANAGER" },
      headers,
    );
    id = made.id;
    expect(made).toMatchObject({ email, role: "MANAGER", expired: false });
    const days = (new Date(made.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect((await getAccess(request)).invitations.map((row) => row.id)).toContain(made.id);

    // Sent again, as an administrator: the same invitation, with the new role.
    const again = await send<Invitation>(
      request,
      "post",
      `${BASE}/invitations`,
      { email, role: "ADMIN" },
      headers,
    );
    expect(again.id).toBe(made.id);
    const held = (await getAccess(request)).invitations.filter((row) => row.email === email);
    expect(held).toHaveLength(1);
    expect(held[0].role).toBe("ADMIN");
  } finally {
    if (id) await request.delete(`${BASE}/invitations/${id}`, { headers });
  }

  expect((await getAccess(request)).invitations.some((row) => row.email === email)).toBe(false);
  // Withdrawing it again finds nothing there.
  const gone = await request.delete(`${BASE}/invitations/${id}`, { headers });
  expect(gone.status()).toBe(404);
});

test("refuses what it cannot take, and changes nothing", async ({ request }) => {
  const headers = await csrfHeader(request);
  const before = await getAccess(request);
  const json = { ...headers, "content-type": "application/json" };

  const refused: [string, () => Promise<{ status(): number }>][] = [
    [
      "a switch change that names no switch",
      () => request.put(`${BASE}/settings`, { data: {}, headers }),
    ],
    [
      "a switch that does not exist",
      () => request.put(`${BASE}/settings`, { data: { openToEveryone: true }, headers }),
    ],
    [
      "a body that is not JSON",
      () => request.put(`${BASE}/settings`, { data: "{not json", headers: json }),
    ],
    ["a JSON null", () => request.put(`${BASE}/settings`, { data: "null", headers: json })],
    [
      "an invitation to an email that is not one",
      () =>
        request.post(`${BASE}/invitations`, {
          data: { email: "not-an-email", role: "MANAGER" },
          headers,
        }),
    ],
    [
      "an invitation as a USER, which no owner route admits",
      () =>
        request.post(`${BASE}/invitations`, {
          data: { email: `user-${STAMP}@example.test`, role: "USER" },
          headers,
        }),
    ],
  ];
  for (const [what, attempt] of refused) {
    expect((await attempt()).status(), what).toBe(400);
  }

  // The account the suite is signed in as already exists, so inviting it admits nobody.
  const { user } = await (await request.get("/api/auth/session")).json();
  const exists = await request.post(`${BASE}/invitations`, {
    data: { email: user.email, role: "MANAGER" },
    headers,
  });
  expect(exists.status()).toBe(409);
  expect((await exists.json()).reason).toBe("account_exists");

  expect(await getAccess(request)).toEqual(before);
});

test("refuses a change that carries no CSRF token", async ({ request }) => {
  const before = (await getAccess(request)).settings;

  const res = await request.put(`${BASE}/settings`, {
    data: { googleSignUp: !before.googleSignUp },
  });

  expect(res.status()).toBe(403);
  expect((await getAccess(request)).settings).toEqual(before);
});

test("keeps an account's role, and refuses what it cannot take: no role, no account, no CSRF token", async ({
  request,
}) => {
  const headers = await csrfHeader(request);
  const before = await getAccess(request);
  const own = before.accounts.find((account) => account.self);
  expect(own, "the signed-in account is not listed").toBeTruthy();
  const url = `${BASE}/accounts/${own?.id}`;

  // The role the account already has is no change, so this cannot cost the suite its administrator.
  const same = await send<Account>(request, "put", url, { role: "ADMIN" }, headers);
  expect(same).toMatchObject({ id: own?.id, role: "ADMIN", self: true });

  const refused: [string, number, () => Promise<{ status(): number }>][] = [
    ["a role that is no role", 400, () => request.put(url, { data: { role: "USER" }, headers })],
    ["a body with no role", 400, () => request.put(url, { data: {}, headers })],
    [
      "an account that is not there",
      404,
      () => request.put(`${BASE}/accounts/nobody`, { data: { role: "MANAGER" }, headers }),
    ],
    ["a change without the CSRF token", 403, () => request.put(url, { data: { role: "MANAGER" } })],
  ];
  for (const [what, status, attempt] of refused) {
    expect((await attempt()).status(), what).toBe(status);
  }

  expect((await getAccess(request)).accounts).toEqual(before.accounts);
});
