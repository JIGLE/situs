/**
 * Enable Banking — PSD2 account information (AIS).
 *
 * Chosen after GoCardless Bank Account Data closed to new signups in July 2025, leaving this repo
 * shipping an adapter no new operator could obtain credentials for. Enable Banking is Finnish, is
 * itself the licensed AISP, and documents a **restricted production** mode: free access limited to
 * accounts you whitelist as your own. That is exactly a self-hosted landlord reading their own
 * bank, so no licence, no eIDAS certificate and no subscription are involved on this path.
 *
 * AUTH IS NOT A TOKEN EXCHANGE. There is no shared secret and nothing to swap for a bearer token:
 * every request carries a JWT this app signs itself with the RSA private key generated when the
 * application was registered, `kid` set to the application id. Signing is a few microseconds, so
 * this mints one per request rather than caching — a cache here would buy nothing and add an
 * invalidation bug waiting to happen.
 *
 * Written against Enable Banking's own published sample
 * (`enablebanking/enablebanking-api-samples`, `python_example/account_information.py`) rather than
 * from memory. The one part NOT confirmed against a real response is `mapTransaction` — see the
 * comment there, and `scripts/enablebanking-check.mjs`, which exists to replace that guess with a
 * recording.
 */

import crypto from "crypto";
import { readFileSync } from "node:fs";

import type { BankRow } from "../rows";
import type {
  BankDataProvider,
  ConsentLink,
  ConsentRequest,
  InstitutionListing,
  ProviderAccount,
  ProviderDiagnostics,
} from "./types";
import { ConsentExpiredError } from "./types";

const DEFAULT_API_BASE = "https://api.enablebanking.com";

/** Sandbox and production applications share this host; the environment is a property of the
 * application you registered, not of the URL. So there is no base to switch between them. */
function apiBase(): string {
  const override = process.env.ENABLE_BANKING_API_BASE?.trim().replace(/\/+$/, "");
  if (!override) return DEFAULT_API_BASE;

  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new Error("ENABLE_BANKING_API_BASE is not a valid URL");
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !loopback) {
    // Requests to this host carry a JWT signed with the application's private key. A typo'd
    // `http://` would put it on the wire in clear — a mistake rather than an attack, but a
    // cheap one to make impossible.
    throw new Error("ENABLE_BANKING_API_BASE must be https:// — signed requests are sent to it");
  }
  return override;
}

/**
 * Requested consent lifetime. Enable Banking accepts an explicit `valid_until`, and banks clamp it
 * downward; asking for 90 days gets whatever the ASPSP is willing to grant.
 */
const ACCESS_VALID_DAYS = 90;

/**
 * Reads allowed per connection per day.
 *
 * Enable Banking publishes no per-day figure equivalent to the four-a-day cap the previous
 * provider's free tier imposed, and restricted production may carry limits of its own. Four is
 * therefore a deliberately conservative guess rather than a documented number: under-syncing costs
 * a delay, over-syncing can cost a day of rejections. Raise it once the real limit is known.
 */
const DAILY_READ_BUDGET = 4;

interface EbAmount {
  amount?: string;
  currency?: string;
}

interface EbParty {
  name?: string;
}

interface EbAccountRef {
  iban?: string;
}

/** One transaction as Enable Banking returns it. Every field is optional — ASPSPs differ wildly. */
export interface EnableBankingTransaction {
  entry_reference?: string;
  booking_date?: string;
  value_date?: string;
  transaction_amount?: EbAmount;
  /** "CRDT" (money in) or "DBIT" (money out). */
  credit_debit_indicator?: string;
  creditor?: EbParty;
  debtor?: EbParty;
  creditor_account?: EbAccountRef;
  debtor_account?: EbAccountRef;
  remittance_information?: string[] | string;
}

interface EbSessionAccount {
  uid?: string;
  account_id?: { iban?: string };
  currency?: string;
  name?: string;
  product?: string;
}

/**
 * Raised when the instance is *trying* to be configured and cannot be — a named path that will
 * not open, or a key that will not parse. Distinct from "no credentials set", an instance that
 * simply has no bank feed, which `/admin` reports as a warning rather than a fault.
 */
export class EnableBankingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnableBankingConfigError";
  }
}

/**
 * The key, read once.
 *
 * Memoised because `isConfigured()` runs on every request that lists providers, and re-reading a
 * file each time is waste. Keyed by source so a test — or a restart-free config change — cannot be
 * served a stale key from a different path.
 */
let keyCache: { source: string; key: string } | null = null;

/** Exported for tests: a module-level cache would otherwise leak between cases. */
export function resetKeyCache(): void {
  keyCache = null;
}

function loadPrivateKey(): string | null {
  // A file first, and it is the documented route for a real deployment. An RSA-2048 PKCS#8 PEM is
  // ~1,700 characters and base64 makes it ~2,272, so it does not fit in a TrueNAS app-config
  // value at all — but the better reason is that an env var holding a private key is readable
  // from /proc/<pid>/environ, shows up in process listings and crash dumps, and is echoed by any
  // diagnostic that prints the environment. A mounted file with 0400 is none of those things.
  const path = process.env.ENABLE_BANKING_PRIVATE_KEY_FILE?.trim();
  if (path) {
    if (keyCache?.source === path) return keyCache.key;
    let contents: string;
    try {
      contents = readFileSync(path, "utf8").trim();
    } catch (error) {
      // Names the path, never the key. An unreadable path is a configuration mistake and has to
      // say so — silently reporting "no provider configured" is how a misconfigured instance
      // looks identical to an unconfigured one.
      throw new EnableBankingConfigError(
        `ENABLE_BANKING_PRIVATE_KEY_FILE is set to "${path}" but it could not be read: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!contents) {
      throw new EnableBankingConfigError(
        `ENABLE_BANKING_PRIVATE_KEY_FILE points at "${path}", which is empty.`,
      );
    }
    keyCache = { source: path, key: contents };
    return contents;
  }

  const inline = process.env.ENABLE_BANKING_PRIVATE_KEY?.trim();
  if (!inline) return null;
  if (keyCache?.source === "inline") return keyCache.key;

  // Base64 is still accepted inline, detected rather than configured — a PEM announces itself.
  // It is no longer *recommended*: it makes an already-too-long value longer.
  const key = inline.includes("-----BEGIN")
    ? inline
    : Buffer.from(inline, "base64").toString("utf8");
  keyCache = { source: "inline", key };
  return key;
}

function credentials(): { applicationId: string; privateKey: string } | null {
  const applicationId = process.env.ENABLE_BANKING_APPLICATION_ID?.trim();
  if (!applicationId) return null;
  const privateKey = loadPrivateKey();
  if (!privateKey) return null;
  return { applicationId, privateKey };
}

/**
 * Whether this instance is configured to offer Enable Banking connections.
 *
 * A configuration ERROR is not "unconfigured": it propagates, so the operator sees the path that
 * will not open rather than a silent "not configured" that looks like a deliberate choice.
 */
export function isEnableBankingConfigured(): boolean {
  return credentials() !== null;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * The `Authorization` JWT, signed with the application's own key.
 *
 * Exported for tests: the claim set is small and exact, and a wrong `aud` or a missing `kid` fails
 * as an opaque 401 from the far end rather than as anything diagnosable.
 */
export function buildAuthJwt(now = new Date()): string {
  const creds = credentials();
  if (!creds) {
    throw new Error(
      "Enable Banking is not configured. Set ENABLE_BANKING_APPLICATION_ID and " +
        "ENABLE_BANKING_PRIVATE_KEY.",
    );
  }

  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: creds.applicationId }));
  const payload = base64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat,
      exp: iat + 3600,
    }),
  );

  let signature: Buffer;
  try {
    signature = crypto
      .createSign("RSA-SHA256")
      .update(`${header}.${payload}`)
      .sign(creds.privateKey);
  } catch (error) {
    // Overwhelmingly this is a PEM whose newlines were lost on the way into a config field —
    // OpenSSL reports it as `DECODER routines::unsupported`, which says nothing useful to anyone
    // who has not seen it before.
    throw new EnableBankingConfigError(
      "The Enable Banking private key could not be used for signing. If it was pasted into a " +
        "single-line field its newlines were probably lost — mount the .pem and set " +
        `ENABLE_BANKING_PRIVATE_KEY_FILE instead. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return `${header}.${payload}.${base64url(signature)}`;
}

async function apiCall<T>(path: string, init?: RequestInit): Promise<T> {
  // Enable Banking's own host, not /api/*: it never passes through proxy.ts's CSRF check, and
  // attaching our CSRF token would disclose it to an external host.
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${buildAuthJwt()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    // At a session or account path this is the shape a revoked consent takes. It is also what a
    // bad key looks like — but the remedy the UI offers (reconnect) is harmless either way, and
    // a wrong key is caught at setup rather than mid-sync.
    throw new ConsentExpiredError();
  }
  if (response.status === 429) {
    throw new Error(
      "Enable Banking rate limit reached. Bank data providers cap how often each account may " +
        "be read; try again later.",
    );
  }
  if (!response.ok) {
    // Deliberately no body echo: an auth failure can quote the request back.
    throw new Error(`Enable Banking request failed (HTTP ${response.status})`);
  }

  return (await response.json()) as T;
}

/**
 * An ASPSP is addressed by `{name, country}`, not by an opaque id, so the pair is packed into the
 * `Institution.id` the picker round-trips. The separator is a colon because an ASPSP name may
 * contain spaces and punctuation but not, in practice, a colon — and `ConsentRequest` carries no
 * country field to pass it in separately.
 */
export function encodeInstitutionId(country: string, name: string): string {
  return `${country.toUpperCase()}:${name}`;
}

export function decodeInstitutionId(id: string): { country: string; name: string } {
  const separator = id.indexOf(":");
  if (separator < 1) {
    throw new Error("Institution id is not in the expected <COUNTRY>:<name> form");
  }
  return { country: id.slice(0, separator).toUpperCase(), name: id.slice(separator + 1) };
}

/**
 * Map one Enable Banking transaction to the row the import pipeline consumes.
 *
 * Pure and exported so it can be tested against recorded payloads without any network. Most of the
 * risk in this integration lives here — a sign error or a swapped counterparty silently mis-matches
 * rent, which is worse than a visible failure because nobody goes looking.
 *
 * **The sign convention here is the one thing not yet confirmed against a real response.** Enable
 * Banking documents `credit_debit_indicator` (CRDT/DBIT) alongside an unsigned `transaction_amount`,
 * and some ASPSPs are reported to send a signed amount instead. Both are handled: an explicit
 * indicator wins, and a signed amount is honoured when no indicator is present. Run
 * `scripts/enablebanking-check.mjs` against a real account and replace the fixtures in the test
 * with what it records.
 */
export function mapTransaction(tx: EnableBankingTransaction): BankRow | null {
  const rawAmount = tx.transaction_amount?.amount;
  const parsed = rawAmount === undefined ? NaN : Number(rawAmount);
  const bookingDate = tx.booking_date ?? tx.value_date;

  // Without an amount or a date there is nothing to match on, and a fingerprint built from
  // undefined would collide with every other broken row.
  if (!Number.isFinite(parsed) || !bookingDate) return null;

  const indicator = tx.credit_debit_indicator?.toUpperCase();
  let amount: number;
  if (indicator === "CRDT") {
    amount = Math.abs(parsed);
  } else if (indicator === "DBIT") {
    amount = -Math.abs(parsed);
  } else {
    // No indicator: trust the sign the ASPSP sent rather than assuming a direction.
    amount = parsed;
  }

  // Which party is the counterparty depends on direction: money IN comes from the debtor (the
  // tenant), money OUT goes to the creditor. Banks frequently populate only one side, so each
  // falls back to the other rather than dropping the name.
  const incoming = amount > 0;
  const counterpartyName = incoming
    ? (tx.debtor?.name ?? tx.creditor?.name)
    : (tx.creditor?.name ?? tx.debtor?.name);
  const counterpartyIban = incoming
    ? (tx.debtor_account?.iban ?? tx.creditor_account?.iban)
    : (tx.creditor_account?.iban ?? tx.debtor_account?.iban);

  const remittance = Array.isArray(tx.remittance_information)
    ? tx.remittance_information.join(" ")
    : tx.remittance_information;

  return {
    bookingDate,
    valueDate: tx.value_date,
    amount,
    counterpartyName: counterpartyName || undefined,
    counterpartyIban: counterpartyIban || undefined,
    reference: remittance || undefined,
  };
}

/**
 * A call that reports its own failure instead of translating it.
 *
 * `apiCall` maps 401/403 to `ConsentExpiredError`, which is right in the sync path — mid-sync,
 * a refused request almost always means a lapsed consent, and the remedy is to reconnect. It is
 * exactly wrong for a setup check: at `/application` there is no consent involved, so a 401 means
 * the key does not match the application id, and telling the operator to reconnect would send
 * them away from the actual problem.
 */
async function probe(
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number | null; reason: string }> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      headers: {
        Authorization: `Bearer ${buildAuthJwt()}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    // A signing failure surfaces here too — `buildAuthJwt` throws when the PEM is unusable, which
    // is the single most common way this is misconfigured (newlines lost to a one-line field).
    return {
      ok: false,
      status: null,
      reason: error instanceof EnableBankingConfigError ? error.message : "network_unreachable",
    };
  }

  if (!response.ok) {
    // No body echo, here of all places: an auth failure can quote the request — and so the
    // signed token — back at us, and this result is rendered in a browser.
    return { ok: false, status: response.status, reason: `http_${response.status}` };
  }

  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, status: response.status, reason: "malformed_json" };
  }
}

export const enableBankingProvider: BankDataProvider = {
  key: "enablebanking",
  displayName: "Enable Banking",
  dailyReadBudget: DAILY_READ_BUDGET,
  isConfigured: isEnableBankingConfigured,

  async listInstitutions(country: string): Promise<InstitutionListing> {
    const wanted = country.toUpperCase();
    const body = await apiCall<{
      aspsps?: {
        name?: string;
        country?: string;
        logo?: string;
        maximum_consent_validity?: number;
      }[];
    }>("/aspsps");

    // Everything the application can reach, before the country filter. A sandbox application
    // returns the Mock ASPSPs its operator configured in the Enable Banking Control Panel — the
    // set is whatever they made, not a fixed list — and a production application not yet
    // activated returns nothing at all. Both used to arrive here as an empty picker reading "no
    // banks available in this country", which pointed at the country and away from the cause.
    const all = body.aspsps ?? [];

    return {
      totalAvailable: all.length,
      institutions: all
        .filter((a) => a.name && (a.country ?? "").toUpperCase() === wanted)
        .map((a) => ({
          id: encodeInstitutionId(wanted, a.name as string),
          name: a.name as string,
          country: wanted,
          logoUrl: a.logo,
        })),
    };
  },

  async createConsentLink(request: ConsentRequest): Promise<ConsentLink> {
    const { country, name } = decodeInstitutionId(request.institutionId);
    const days = request.accessValidForDays ?? ACCESS_VALID_DAYS;
    const validUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const body = await apiCall<{ url?: string }>("/auth", {
      method: "POST",
      body: JSON.stringify({
        access: { valid_until: validUntil.toISOString() },
        aspsp: { name, country },
        // Our unguessable nonce. Enable Banking echoes it back on the redirect as `state`, which
        // is what ties the returning consent to the account that started it.
        state: request.reference,
        // Must be one of the URLs registered for the application in their Control Panel; a
        // mismatch is rejected there rather than silently redirecting somewhere else.
        redirect_url: request.redirectUrl,
        psu_type: "personal",
      }),
    });

    if (!body.url) throw new Error("Enable Banking returned no authorisation URL");

    // No id exists yet: the session — and its id — are created when the user comes back with a
    // code. `ConsentLink.providerRef` is nullable precisely for this shape.
    return { providerRef: null, url: body.url, expiresAt: validUntil };
  },

  async completeConsent({ callbackParams }): Promise<ProviderAccount[]> {
    const code = callbackParams.code;
    if (!code) {
      // The user closed the bank's page, or the bank refused. Either way there is no session to
      // create, and the remedy is to start again — which is what ConsentExpiredError means here.
      throw new ConsentExpiredError("The bank did not authorise the connection. Try again.");
    }

    const session = await apiCall<{ session_id?: string; accounts?: EbSessionAccount[] }>(
      "/sessions",
      { method: "POST", body: JSON.stringify({ code }) },
    );

    const accounts = session.accounts ?? [];
    if (accounts.length === 0) {
      throw new ConsentExpiredError("The bank granted no accounts. Try connecting again.");
    }

    return Promise.all(
      accounts
        .filter((a): a is EbSessionAccount & { uid: string } => Boolean(a.uid))
        .map(async (account) => {
          const label = account.name || account.product || "Bank account";
          if (account.account_id?.iban) {
            return {
              id: account.uid,
              iban: account.account_id.iban,
              currency: account.currency,
              label,
            };
          }

          // Some ASPSPs omit the identification from the session payload. Details are a separate
          // call; losing them must not lose the account, because transactions — the thing we
          // actually need — come from a different endpoint entirely.
          try {
            const details = await apiCall<{
              account?: { account_id?: { iban?: string }; currency?: string; name?: string };
            }>(`/accounts/${encodeURIComponent(account.uid)}/details`);
            return {
              id: account.uid,
              iban: details.account?.account_id?.iban,
              currency: details.account?.currency ?? account.currency,
              label: details.account?.name || label,
            };
          } catch {
            return { id: account.uid, currency: account.currency, label };
          }
        }),
    );
  },

  async fetchTransactions(accountRef: string, since?: Date): Promise<BankRow[]> {
    const rows: BankRow[] = [];
    let continuationKey: string | undefined;

    // Paging is not optional. Enable Banking returns a `continuation_key` whenever more remains,
    // and stopping at the first page would silently truncate history — which on a first sync
    // reads as "no movements" rather than as an error.
    do {
      const query = new URLSearchParams();
      if (since) query.set("date_from", since.toISOString().slice(0, 10));
      if (continuationKey) query.set("continuation_key", continuationKey);
      const suffix = query.toString() ? `?${query}` : "";

      const body = await apiCall<{
        transactions?: EnableBankingTransaction[];
        continuation_key?: string;
      }>(`/accounts/${encodeURIComponent(accountRef)}/transactions${suffix}`);

      for (const tx of body.transactions ?? []) {
        const row = mapTransaction(tx);
        if (row) rows.push(row);
      }
      continuationKey = body.continuation_key;
    } while (continuationKey);

    return rows;
  },

  /**
   * Read-only. Two calls, both GET, neither of which grants or spends anything: `/application`
   * says who we are and where the provider will redirect back to, `/aspsps` says what we can
   * reach. Between them they separate the four failure modes that all looked like "empty picker".
   */
  async diagnose(expectedRedirectUrl: string | null): Promise<ProviderDiagnostics> {
    const base: ProviderDiagnostics = {
      configured: isEnableBankingConfigured(),
      authenticated: null,
      authError: null,
      applicationName: null,
      environment: null,
      redirectUrls: [],
      expectedRedirectUrl,
      redirectUrlRegistered: null,
      institutionsTotal: null,
      institutionsByCountry: [],
    };

    if (!base.configured) return base;

    const app = await probe("/application");
    if (!app.ok) {
      return { ...base, authenticated: false, authError: app.reason };
    }

    const body = app.body as {
      name?: string;
      environment?: string;
      redirect_urls?: string[];
      active?: boolean;
    };
    const redirectUrls = Array.isArray(body.redirect_urls) ? body.redirect_urls : [];

    const result: ProviderDiagnostics = {
      ...base,
      authenticated: true,
      applicationName: body.name ?? null,
      environment: body.environment ?? null,
      redirectUrls,
      // Compared exactly, because that is how the provider compares it. A trailing slash or an
      // http/https mismatch is a real mismatch and the operator needs to see which.
      redirectUrlRegistered: expectedRedirectUrl
        ? redirectUrls.includes(expectedRedirectUrl)
        : null,
    };

    const aspsps = await probe("/aspsps");
    if (!aspsps.ok) return result;

    const list = ((aspsps.body as { aspsps?: { country?: string }[] }).aspsps ?? []).filter(
      Boolean,
    );
    const counts = new Map<string, number>();
    for (const entry of list) {
      const country = (entry.country ?? "??").toUpperCase();
      counts.set(country, (counts.get(country) ?? 0) + 1);
    }

    return {
      ...result,
      institutionsTotal: list.length,
      institutionsByCountry: [...counts.entries()]
        .map(([country, count]) => ({ country, count }))
        .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country)),
    };
  },
};
