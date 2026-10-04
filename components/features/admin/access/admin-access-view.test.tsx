import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/dom";
import {
  fireEvent,
  renderWithProviders as render,
  screen,
  waitFor,
} from "@/tests/helpers/render-with-providers";
import { formatDate } from "@/lib/utils/format-date";
import enMessages from "@/messages/en.json";
import ptMessages from "@/messages/pt.json";

/**
 * Admin › Acessos as the owner reads it, in Portuguese: the sentence that says whether a stranger can
 * make an account, the two switches, the invitations, and each account's role.
 *
 * The routes are a small fake that keeps what it was told, so every test goes the whole way: a
 * click sends the request the API expects, and the screen shows what the fake then holds, read
 * again, not what was clicked. A refusal is checked for what it leaves on screen as much as for what
 * it says, since a switch that shows a state the server does not hold is the lie this screen must
 * not tell.
 */

const { toast, push } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  push: vi.fn(),
}));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => toast }));
vi.mock("@/lib/contexts/csrf-context", () => ({ useCsrf: () => ({ token: "csrf-token" }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/access",
}));

import { AdminAccessView } from "./admin-access-view";

const api = ptMessages.errors.api;
const access = ptMessages.admin.access;
const signIn = ptMessages.admin.signIn;

type Role = "ADMIN" | "MANAGER" | "USER";
interface Account {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
  self: boolean;
}
interface Invitation {
  id: string;
  email: string;
  role: "ADMIN" | "MANAGER";
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}
type Registration = "open_bootstrap" | "google" | "invitations" | "closed";

const OWNER: Account = {
  id: "acc-1",
  email: "owner@example.test",
  name: "Ana Lopes",
  role: "ADMIN",
  createdAt: "2026-09-01T00:00:00.000Z",
  self: true,
};
const PARTNER: Account = {
  id: "acc-2",
  email: "partner@example.test",
  name: null,
  role: "MANAGER",
  createdAt: "2026-09-20T00:00:00.000Z",
  self: false,
};
const GUEST: Invitation = {
  id: "inv-1",
  email: "guest@example.test",
  role: "MANAGER",
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2099-10-31T00:00:00.000Z",
  expired: false,
};
const LAPSED: Invitation = {
  id: "inv-2",
  email: "late@example.test",
  role: "ADMIN",
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-08-31T00:00:00.000Z",
  expired: true,
};

interface World {
  settings: { googleSignUp: boolean; invitations: boolean };
  invitations: Invitation[];
  accounts: Account[];
  registration: Registration;
  pendingInvitations: number;
  /** Answers a write with this instead of applying it. */
  refuse: { status: number; reason?: string; field?: string } | null;
  /** Answers the access route with this status while set. */
  accessStatus: number;
}
let world: World;
/** While set, a write does not answer until it is released. */
let gate: Promise<void> | null;
let requests: { url: string; method: string; body: unknown; headers: Record<string, string> }[];

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, statusText: "", json: async () => body }) as Response;

/** What the fake holds after a write: the registration sentence follows the switches. */
function settle() {
  world.pendingInvitations = world.invitations.filter((invitation) => !invitation.expired).length;
  world.registration = world.settings.googleSignUp
    ? "google"
    : world.settings.invitations && world.pendingInvitations > 0
      ? "invitations"
      : "closed";
}

beforeAll(() => {
  // Radix Select measures and scrolls its options, which jsdom does not implement.
  if (typeof Element.prototype.scrollIntoView !== "function") {
    Element.prototype.scrollIntoView = () => {};
  }
  if (typeof globalThis.ResizeObserver !== "function") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  requests = [];
  gate = null;
  world = {
    settings: { googleSignUp: false, invitations: true },
    // Copies: a write changes the rows the fake holds, and a fixture shared by every test would
    // carry one test's role change into the next.
    invitations: [{ ...GUEST }],
    accounts: [{ ...OWNER }, { ...PARTNER }],
    registration: "invitations",
    pendingInvitations: 1,
    refuse: null,
    accessStatus: 200,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({
        url,
        method,
        body,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });

      if (method === "GET" && url === "/api/admin/access") {
        if (world.accessStatus !== 200) return reply(world.accessStatus, { error: "nope" });
        return reply(200, {
          data: {
            settings: world.settings,
            invitations: world.invitations,
            allowlist: ["operator@example.test"],
            accounts: world.accounts,
          },
        });
      }
      if (method === "GET" && url === "/api/admin/sign-in-status") {
        return reply(200, {
          data: {
            providers: [
              { key: "credentials", configured: true },
              { key: "google", configured: true },
            ],
            registration: world.registration,
            pendingInvitations: world.pendingInvitations,
            totalAccounts: world.accounts.length,
            adminAccounts: world.accounts.filter((account) => account.role === "ADMIN").length,
            allowlist: ["operator@example.test"],
          },
        });
      }

      if (method !== "GET" && gate) await gate;
      if (world.refuse) {
        return reply(world.refuse.status, {
          error: "refused",
          reason: world.refuse.reason,
          field: world.refuse.field,
        });
      }
      if (method === "PUT" && url === "/api/admin/access/settings") {
        world.settings = { ...world.settings, ...body };
        settle();
        return reply(200, { data: world.settings });
      }
      if (method === "POST" && url === "/api/admin/access/invitations") {
        const made: Invitation = {
          id: `inv-${world.invitations.length + 10}`,
          email: body.email,
          role: body.role,
          createdAt: "2026-10-04T00:00:00.000Z",
          expiresAt: "2099-11-03T00:00:00.000Z",
          expired: false,
        };
        world.invitations = [made, ...world.invitations];
        settle();
        return reply(201, { data: made });
      }
      if (method === "DELETE" && url.startsWith("/api/admin/access/invitations/")) {
        world.invitations = world.invitations.filter((i) => url.endsWith(`/${i.id}`) === false);
        settle();
        return reply(200, { data: { removed: true } });
      }
      if (method === "PUT" && url.startsWith("/api/admin/access/accounts/")) {
        const account = world.accounts.find((a) => url.endsWith(`/${a.id}`));
        if (!account) return reply(404, { error: "not found" });
        account.role = body.role;
        return reply(200, { data: account });
      }
      return reply(404, { error: `unexpected ${method} ${url}` });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const writes = () => requests.filter((request) => request.method !== "GET");
const reads = (url: string) => requests.filter((r) => r.method === "GET" && r.url === url).length;

/** The screen once it has loaded. */
async function open() {
  render(<AdminAccessView />, { initialLocale: "pt" });
  await screen.findByText(access.subtitle);
}

/** Opens a Radix Select from the keyboard and picks an option by its name. */
async function choose(select: HTMLElement, option: string) {
  fireEvent.keyDown(select, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

/**
 * Every sentence of this screen's namespaces in English that has a different Portuguese one, and
 * is found in the Portuguese render: a component that bypassed the catalogue. The assertions below
 * name what each part should say; this one catches the part nobody thought to name.
 */
function englishLeaks(): string[] {
  const html = document.body.innerHTML;
  // Whole words only: "Remove" is inside the Portuguese "Remover" and is no leak.
  const isLetter = (character: string | undefined) =>
    character !== undefined && /\p{L}/u.test(character);
  const appears = (sentence: string) => {
    for (let at = html.indexOf(sentence); at !== -1; at = html.indexOf(sentence, at + 1)) {
      if (!isLetter(html[at - 1]) && !isLetter(html[at + sentence.length])) return true;
    }
    return false;
  };
  const leaks: string[] = [];
  const walk = (en: unknown, pt: unknown, path: string) => {
    if (typeof en === "string") {
      // A sentence with a placeholder is rendered with its values filled in, so it never appears as written.
      if (pt !== en && !en.includes("{") && en.length >= 6 && appears(en)) {
        leaks.push(`${path}: ${en}`);
      }
      return;
    }
    if (en && typeof en === "object") {
      for (const [key, value] of Object.entries(en)) {
        walk(value, (pt as Record<string, unknown> | undefined)?.[key], `${path}.${key}`);
      }
    }
  };
  walk(enMessages.admin.access, ptMessages.admin.access, "admin.access");
  walk(enMessages.admin.signIn, ptMessages.admin.signIn, "admin.signIn");
  walk(enMessages.actions, ptMessages.actions, "actions");
  return leaks;
}

describe("AdminAccessView: who can create an account", () => {
  it.each<[Registration, string, string, boolean]>([
    ["closed", "Registo fechado", signIn.registrationClosedHelp, false],
    ["invitations", "O registo é por convite", "Há 1 convite pendente.", false],
    ["google", "O registo está aberto a contas Google", signIn.registrationGoogleHelp, true],
    ["open_bootstrap", "Registo aberto", signIn.registrationOpenHelp, true],
  ])("says in words that registration is %s", async (registration, title, help, open_) => {
    world.registration = registration;
    await open();

    expect(screen.getByText(title)).toBeInTheDocument();
    // A state that lets a person nobody named in is tinted as a warning; the others are not.
    const card = screen.getByText(title).closest("section");
    if (open_) expect(card).toHaveClass("border-l-2");
    else expect(card).not.toHaveClass("border-l-2");
    // The help runs on after the title's sentence in some states, so it is matched as part of the text.
    expect(screen.getByText(help, { exact: false })).toBeInTheDocument();
    // The count of accounts, as text, in the owner's language.
    expect(screen.getByText("2 contas, das quais 1 é administrador.")).toBeInTheDocument();
  });

  it("shows no English anywhere in the Portuguese screen, the invitations' warning and a lapsed invitation included", async () => {
    world.settings.invitations = false;
    world.invitations = [{ ...GUEST }, { ...LAPSED }];
    world.accounts = [{ ...OWNER }, { ...PARTNER }, { ...PARTNER, id: "acc-3", role: "USER" }];
    settle();
    await open();

    // The screen shows something to check, or an empty one would pass.
    expect(screen.getByText(access.invitations.off)).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(englishLeaks()).toEqual([]);
  });

  it("lists the sign-in methods and the allowlist, which only report", async () => {
    await open();

    expect(screen.getByText("Métodos de acesso")).toBeInTheDocument();
    expect(screen.getByText("Email e palavra-passe")).toBeInTheDocument();
    expect(screen.getByText("Emails permitidos")).toBeInTheDocument();
    expect(screen.getByText("operator@example.test")).toBeInTheDocument();
    // Nothing on them can be switched: the two switches of the screen are the sign-up ones.
    expect(screen.getAllByRole("switch")).toHaveLength(2);
  });

  it("says it could not load, in words, when a route fails", async () => {
    world.accessStatus = 500;
    render(<AdminAccessView />, { initialLocale: "pt" });

    expect(await screen.findByRole("alert")).toHaveTextContent(access.loadFailed);
  });
});

describe("AdminAccessView: the two switches", () => {
  it("shows each as stored, and the whole row is the control, named and described", async () => {
    await open();

    const invitations = screen.getByRole("switch", { name: "Convites" });
    const google = screen.getByRole("switch", { name: "Registo com Google" });
    expect(invitations).toHaveAttribute("aria-checked", "true");
    expect(google).toHaveAttribute("aria-checked", "false");
    expect(invitations).toHaveAccessibleDescription(access.newAccounts.invitationsHelp);
    expect(google).toHaveAccessibleDescription(access.newAccounts.googleSignUpHelp);
    // The help is the row's own text, so a tap on it reaches the switch.
    expect(within(google).getByText(access.newAccounts.googleSignUpHelp)).toBeInTheDocument();
  });

  it("changes invitations without asking, says so, and reads what is stored", async () => {
    await open();
    const readsBefore = reads("/api/admin/sign-in-status");

    fireEvent.click(screen.getByRole("switch", { name: "Convites" }));

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Convites" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(writes()).toEqual([
      expect.objectContaining({
        url: "/api/admin/access/settings",
        method: "PUT",
        body: { invitations: false },
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    ]);
    expect(toast.success).toHaveBeenCalledWith("Guardado.");
    // The sentence at the top is the server's, read again, and now says there is nothing to admit.
    expect(reads("/api/admin/sign-in-status")).toBe(readsBefore + 1);
    expect(await screen.findByText("Registo fechado")).toBeInTheDocument();
    // The invitations that are held say they admit nobody while the switch is off.
    expect(screen.getByText(access.invitations.off)).toBeInTheDocument();
  });

  it("asks before opening Google sign-up, and sends nothing when the owner declines", async () => {
    await open();

    fireEvent.click(screen.getByRole("switch", { name: "Registo com Google" }));

    expect(await screen.findByText("Abrir a qualquer conta Google?")).toBeInTheDocument();
    expect(screen.getByText(access.newAccounts.openGoogleDescription)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByText("Abrir a qualquer conta Google?")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([]);
    expect(screen.getByRole("switch", { name: "Registo com Google" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("opens Google sign-up once the owner has confirmed, and the sentence follows", async () => {
    await open();

    fireEvent.click(screen.getByRole("switch", { name: "Registo com Google" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir a contas Google" }));

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Registo com Google" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(writes().map((write) => [write.method, write.url, write.body])).toEqual([
      ["PUT", "/api/admin/access/settings", { googleSignUp: true }],
    ]);
    expect(await screen.findByText("O registo está aberto a contas Google")).toBeInTheDocument();
  });

  it("closes Google sign-up without asking: closing a door needs no second thought", async () => {
    world.settings.googleSignUp = true;
    settle();
    await open();

    fireEvent.click(screen.getByRole("switch", { name: "Registo com Google" }));

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Registo com Google" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(screen.queryByText("Abrir a qualquer conta Google?")).not.toBeInTheDocument();
    expect(writes().map((write) => write.body)).toEqual([{ googleSignUp: false }]);
  });

  it("ignores a second click while the first change is still being saved", async () => {
    await open();
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invitations = screen.getByRole("switch", { name: "Convites" });

    fireEvent.click(invitations);
    await waitFor(() => expect(invitations).toBeDisabled());
    expect(invitations).toHaveAttribute("aria-busy", "true");
    // While it saves the switch still shows what is stored: the click is not believed until read back.
    expect(invitations).toHaveAttribute("aria-checked", "true");
    fireEvent.click(invitations);
    release();

    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Convites" })).toHaveAttribute(
        "aria-checked",
        "false",
      ),
    );
    expect(writes().map((write) => write.body)).toEqual([{ invitations: false }]);
  });

  it("leaves a switch where it was when the change is refused, and says why", async () => {
    await open();
    world.refuse = { status: 500 };

    fireEvent.click(screen.getByRole("switch", { name: "Convites" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(api.serverError));
    expect(toast.success).not.toHaveBeenCalled();
    // Never the state that was clicked, only the one the server holds.
    expect(screen.getByRole("switch", { name: "Convites" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

describe("AdminAccessView: invitations", () => {
  it("lists each with its role and when it lapses, and says so for one that has", async () => {
    world.invitations = [{ ...GUEST }, { ...LAPSED }];
    settle();
    await open();

    expect(screen.getByText("guest@example.test")).toBeInTheDocument();
    expect(
      screen.getByText(`Gestor · Expira a ${formatDate(GUEST.expiresAt, "pt")}`),
    ).toBeInTheDocument();
    expect(screen.getByText("late@example.test")).toBeInTheDocument();
    expect(screen.getByText(/^Administrador ·/)).toHaveTextContent("Administrador · Expirado");
  });

  it("invites an email as a manager unless told otherwise, and clears the field", async () => {
    await open();
    const invite = screen.getByRole("button", { name: "Convidar" });
    expect(invite).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Email a convidar"), {
      target: { value: "  new@example.test " },
    });
    expect(invite).toBeEnabled();
    fireEvent.click(invite);

    expect(await screen.findByText("new@example.test")).toBeInTheDocument();
    expect(writes()).toEqual([
      expect.objectContaining({
        url: "/api/admin/access/invitations",
        method: "POST",
        body: { email: "new@example.test", role: "MANAGER" },
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-token" }),
      }),
    ]);
    expect(toast.success).toHaveBeenCalledWith("Convite guardado.");
    await waitFor(() => expect(screen.getByLabelText("Email a convidar")).toHaveValue(""));
  });

  it("invites as an administrator when the owner picks the role", async () => {
    await open();

    fireEvent.change(screen.getByLabelText("Email a convidar"), {
      target: { value: "boss@example.test" },
    });
    await choose(screen.getByRole("combobox", { name: "Função" }), "Administrador");
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ email: "boss@example.test", role: "ADMIN" });
  });

  it("sends an email that is not one to the server, which says so in the owner's language", async () => {
    await open();
    world.refuse = { status: 400, field: "email" };

    // Not the browser's own bubble, which would be in the browser's language.
    fireEvent.change(screen.getByLabelText("Email a convidar"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        api.invalidField.replace("{field}", ptMessages.forms.email),
      ),
    );
    expect(writes().map((write) => write.body)).toEqual([
      { email: "not-an-email", role: "MANAGER" },
    ]);
  });

  it("says an email that already has an account has one, and keeps what was typed", async () => {
    await open();
    world.refuse = { status: 409, reason: "account_exists" };

    fireEvent.change(screen.getByLabelText("Email a convidar"), {
      target: { value: "partner@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Convidar" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(api.accountExists));
    expect(screen.getByLabelText("Email a convidar")).toHaveValue("partner@example.test");
  });

  it("removes an invitation, and says there are none left", async () => {
    await open();

    fireEvent.click(
      screen.getByRole("button", { name: "Remover o convite de guest@example.test" }),
    );

    expect(await screen.findByText(access.invitations.empty)).toBeInTheDocument();
    expect(writes().map((write) => [write.method, write.url])).toEqual([
      ["DELETE", "/api/admin/access/invitations/inv-1"],
    ]);
    expect(toast.success).toHaveBeenCalledWith("Convite removido.");
  });

  it("does not warn that invitations admit nobody while the switch is on", async () => {
    await open();

    expect(screen.queryByText(access.invitations.off)).not.toBeInTheDocument();
  });
});

describe("AdminAccessView: accounts and their roles", () => {
  it("names each account, marks the reader's own, and shows the role it holds", async () => {
    await open();

    expect(screen.getByText("Ana Lopes")).toBeInTheDocument();
    expect(screen.getByText("A sua conta")).toBeInTheDocument();
    expect(screen.getByText(`Desde ${formatDate(OWNER.createdAt, "pt")}`)).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Função de owner@example.test" }),
    ).toHaveTextContent("Administrador");
    // An account with no name is known by its email.
    expect(screen.getByText("partner@example.test")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Função de partner@example.test" }),
    ).toHaveTextContent("Gestor");
  });

  it("knows an account whose name is blank by its email", async () => {
    world.accounts = [{ ...OWNER, name: "   " }, { ...PARTNER }];
    await open();

    // The email is the heading, beside the mark of the reader's own account.
    expect(screen.getByText("owner@example.test").closest("p")).toHaveTextContent("A sua conta");
  });

  it("changes another account's role without asking, and reads it back", async () => {
    await open();

    await choose(
      screen.getByRole("combobox", { name: "Função de partner@example.test" }),
      "Administrador",
    );

    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Função de partner@example.test" }),
      ).toHaveTextContent("Administrador"),
    );
    expect(writes().map((write) => [write.method, write.url, write.body])).toEqual([
      ["PUT", "/api/admin/access/accounts/acc-2", { role: "ADMIN" }],
    ]);
    expect(toast.success).toHaveBeenCalledWith("Função alterada.");
    // The sentence at the top counts them again.
    expect(
      await screen.findByText("2 contas, das quais 2 são administradores."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores a second change to an account while the first is still being saved", async () => {
    await open();
    let release = () => {};
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const role = screen.getByRole("combobox", { name: "Função de partner@example.test" });

    await choose(role, "Administrador");
    await waitFor(() => expect(role).toBeDisabled());
    release();

    await waitFor(() => expect(role).toHaveTextContent("Administrador"));
    expect(writes().map((write) => write.body)).toEqual([{ role: "ADMIN" }]);
  });

  it("sends nothing when the role picked is the one the account already holds", async () => {
    await open();

    await choose(
      screen.getByRole("combobox", { name: "Função de partner@example.test" }),
      "Gestor",
    );

    expect(writes()).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("says the instance needs an administrator, and keeps the role the account holds", async () => {
    world.accounts = [{ ...OWNER }, { ...PARTNER, role: "ADMIN" }];
    await open();
    // The screen is a moment old: by the time the click arrives the partner is the only
    // administrator left, so the server refuses to demote them.
    world.refuse = { status: 409, reason: "last_admin" };

    await choose(
      screen.getByRole("combobox", { name: "Função de partner@example.test" }),
      "Gestor",
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(api.lastAdmin));
    expect(
      screen.getByRole("combobox", { name: "Função de partner@example.test" }),
    ).toHaveTextContent("Administrador");
  });

  it("says someone else changed the account, and reads it again", async () => {
    await open();
    const readsBefore = reads("/api/admin/access");
    world.refuse = { status: 409, reason: "account_changed" };

    await choose(
      screen.getByRole("combobox", { name: "Função de partner@example.test" }),
      "Administrador",
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(api.accountChanged));
    await waitFor(() => expect(reads("/api/admin/access")).toBe(readsBefore + 1));
  });

  it("asks before the owner gives up their own administrator role, and sends nothing if they decline", async () => {
    await open();

    await choose(screen.getByRole("combobox", { name: "Função de owner@example.test" }), "Gestor");

    expect(await screen.findByText("Deixar de ser administrador?")).toBeInTheDocument();
    expect(screen.getByText(access.accounts.demoteSelfDescription)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByText("Deixar de ser administrador?")).not.toBeInTheDocument(),
    );
    expect(writes()).toEqual([]);
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: "Função de owner@example.test" }),
    ).toHaveTextContent("Administrador");
  });

  it("leaves Admin once the owner has given up their administrator role: the next request would be refused", async () => {
    await open();
    const readsBefore = reads("/api/admin/access");

    await choose(screen.getByRole("combobox", { name: "Função de owner@example.test" }), "Gestor");
    fireEvent.click(await screen.findByRole("button", { name: "Passar a gestor" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
    expect(writes().map((write) => [write.method, write.url, write.body])).toEqual([
      ["PUT", "/api/admin/access/accounts/acc-1", { role: "MANAGER" }],
    ]);
    expect(toast.success).toHaveBeenCalledWith("Função alterada.");
    // It does not read again: that read would be the refusal it is leaving for.
    expect(reads("/api/admin/access")).toBe(readsBefore);
  });

  it("stays on Admin when giving up the role is refused, since the owner is still an administrator", async () => {
    await open();
    world.refuse = { status: 409, reason: "last_admin" };

    await choose(screen.getByRole("combobox", { name: "Função de owner@example.test" }), "Gestor");
    fireEvent.click(await screen.findByRole("button", { name: "Passar a gestor" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(api.lastAdmin));
    expect(push).not.toHaveBeenCalled();
    expect(
      screen.getByRole("combobox", { name: "Função de owner@example.test" }),
    ).toHaveTextContent("Administrador");
  });

  it("names the role of an account that holds none a screen can give", async () => {
    world.accounts = [{ ...OWNER }, { ...PARTNER, role: "USER" }];
    await open();

    expect(
      screen.getByRole("combobox", { name: "Função de partner@example.test" }),
    ).toHaveTextContent("Sem acesso");
  });
});
