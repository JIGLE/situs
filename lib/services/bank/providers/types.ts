/**
 * Situs bank data provider contract — PSD2 account information (AIS).
 *
 * A provider's job is narrow on purpose: authenticate, walk the consent flow, and hand back
 * transactions as `BankRow[]`. It does NOT match, dedupe, score or allocate — that pipeline
 * already exists in `lib/services/bank/import.ts` and is exercised by its own tests. Returning
 * the one row shape the import takes is what lets a live connection reuse all of it, so a provider
 * gets the fingerprint dedupe, the reconciliation rules, the confidence engine and the 0.85
 * auto-allocation threshold for free.
 *
 * WHY THIS FILE HAS NO RUNTIME IMPORTS, AND MUST KEEP NONE.
 *
 * `lib/tax/connectors/modes.ts` records the failure this avoids: a "use client" component
 * imported a presentation helper, which imported a guard, which reached Prisma and therefore
 * `better-sqlite3`'s native binding. `next build` failed while `tsc --noEmit`, ESLint and Vitest
 * all passed, because none of them bundle for a browser. The connect UI needs these types, so
 * this module stays type-only — `import type` is fine, a value import is not.
 */

import type { BankRow } from "../rows";

/** A bank the provider can connect to, for the institution picker. */
export interface Institution {
  /** Provider-scoped id, opaque to everything outside the adapter that issued it. */
  id: string;
  name: string;
  /** ISO-3166 alpha-2, upper case. */
  country: string;
  logoUrl?: string;
  /**
   * How many days of history this institution will return. Banks differ wildly (30–730), and
   * the first sync should not silently look like "no movements" because the bank only offers a
   * fortnight.
   */
  maxHistoricalDays?: number;
}

/**
 * The picker's answer, with the count it was filtered from.
 *
 * `totalAvailable` exists because an empty `institutions` has three causes with three different
 * remedies, and they were indistinguishable: the provider returned banks but none in this country
 * (wrong application type), the provider returned nothing at all (a sandbox application, or a
 * production one not yet activated), or our own country filter matched nothing because the
 * provider names the field differently. The UI said "no banks available for this country" for all
 * three — a claim it could not actually support, and one that cost five exchanges to see past.
 *
 * Counted BEFORE the country filter, deliberately. After filtering it would only ever restate
 * `institutions.length` and answer nothing.
 */
export interface InstitutionListing {
  institutions: Institution[];
  totalAvailable: number;
}

export interface ConsentRequest {
  institutionId: string;
  /** Absolute URL the bank returns the user to. Must be pre-registered with the provider. */
  redirectUrl: string;
  /**
   * Opaque value echoed back on the callback. It is the ONLY thing tying a returning consent to
   * the account that started it — see `app/api/bank/connections/callback/route.ts`.
   */
  reference: string;
  /** Requested consent lifetime in days. Providers cap this; the provider clamps rather than throws. */
  accessValidForDays?: number;
  maxHistoricalDays?: number;
}

export interface ConsentLink {
  /**
   * The provider's own id for this consent, persisted as `BankConnection.consentId`.
   *
   * Nullable because not every provider has one to give yet. Some mint the id when consent
   * STARTS and hand it over here; others return only a URL and mint the id when the user comes
   * back, in exchange for a code on the redirect. Requiring an id at this point would rule the
   * second shape out.
   */
  providerRef: string | null;
  /** Where to send the user to authenticate with their bank. */
  url: string;
  /** When the consent lapses and the user must re-authorise. Null when the provider does not say. */
  expiresAt: Date | null;
}

/** An account the user granted access to, discovered after consent completes. */
export interface ProviderAccount {
  /** Provider-scoped account id, used for later transaction fetches. */
  id: string;
  iban?: string;
  currency?: string;
  /** Human label — account name, product name, or the institution as a fallback. */
  label: string;
}

/**
 * Thrown when a consent has lapsed or been revoked at the bank.
 *
 * Distinct from a generic failure because the remedy is different and the UI must say so: an
 * expired consent needs the user to re-authorise, and reporting it as "0 new movements" would be
 * a silent, indefinite outage of the thing the feature exists to do.
 */
export class ConsentExpiredError extends Error {
  constructor(message = "Bank consent has expired and must be renewed") {
    super(message);
    this.name = "ConsentExpiredError";
  }
}

/**
 * What a provider can tell an operator about its own configuration, without moving any money or
 * granting any consent.
 *
 * This exists because every setup failure so far looked identical from the app: an empty bank
 * picker. A missing key, a key that does not match the application id, an application not yet
 * approved for production, and a redirect URL that was never registered all produced the same
 * blank list — and the one the operator hits most, the unregistered redirect, does not surface
 * until they have already been sent to a bank and bounced back.
 *
 * Every field is either a fact the provider stated or `null` for "could not establish". Nothing
 * here is inferred, because a confident wrong diagnosis is worse than no diagnosis.
 */
export interface ProviderDiagnostics {
  /** Whether credentials are present at all. False makes every later field null. */
  configured: boolean;
  /** True once the provider accepted a signed request. Null when not attempted. */
  authenticated: boolean | null;
  /**
   * Why authentication failed, in terms an operator can act on. Never the provider's response
   * body: an auth failure can quote the request — and therefore the signed token — back.
   */
  authError: string | null;
  /** The application's own name, as the provider reports it. */
  applicationName: string | null;
  /**
   * The environment the provider says this application is in — "sandbox", "production", or
   * whatever string it actually returns. NOT derived from the URL: with Enable Banking both
   * environments share a host, so the application is the only thing that knows.
   */
  environment: string | null;
  /** Redirect URLs registered with the provider, and whether ours is among them. */
  redirectUrls: string[];
  /** The callback this instance will actually send, from NEXTAUTH_URL. */
  expectedRedirectUrl: string | null;
  redirectUrlRegistered: boolean | null;
  /** Institutions the application can reach at all, before any country filter. */
  institutionsTotal: number | null;
  /** Per-country counts, so "none in your country" is distinguishable from "none at all". */
  institutionsByCountry: { country: string; count: number }[];
}

export interface BankDataProvider {
  /** Stable key; `BankConnection.provider` is stored as `psd2_<key>`. */
  key: string;

  /** Name for the picker, shown only when an instance has more than one provider. */
  displayName: string;

  /**
   * Whether this instance holds usable credentials for this provider.
   *
   * Lives on the provider because the registry used to name one key and return `false` for
   * every other — so a second adapter could be registered, resolved and fully credentialled, and
   * still never be offered, with no error anywhere to say why. Registering a provider is now the
   * only step needed to make it available.
   */
  isConfigured(): boolean;

  /**
   * Provider reads allowed per connection per day, enforced by `sync.ts` BEFORE a call is spent.
   *
   * This is a commercial term, not a property of open banking, so it belongs to the adapter that
   * knows it. It was a module-level `DAILY_SYNC_BUDGET = 4` justified entirely by one provider's
   * free tier — a rule that would have outlived the vendor that explained it.
   *
   * Under-syncing costs a delay; over-syncing can cost a whole day of 429s. Be conservative.
   */
  dailyReadBudget: number;

  /** Banks available in a country, for the picker. */
  listInstitutions(country: string): Promise<InstitutionListing>;

  /** Begin consent. Returns the URL to send the user to. */
  createConsentLink(request: ConsentRequest): Promise<ConsentLink>;

  /**
   * Finish consent and list the accounts it granted.
   *
   * Takes BOTH what we stored at consent-start and what the bank put on the redirect, because
   * providers split the necessary information differently: one finishes from an id it gave us
   * up front, another needs a single-use `code` that only exists on the callback. Handing over
   * both, and letting the adapter take what it needs, is what stops the shape of one provider's
   * flow from being baked into the service layer.
   *
   * `callbackParams` is every query parameter the redirect carried, unfiltered — the route does
   * not get to decide which ones matter.
   *
   * Throws `ConsentExpiredError` if the user abandoned or the bank refused.
   */
  completeConsent(input: {
    providerRef: string | null;
    callbackParams: Readonly<Record<string, string>>;
  }): Promise<ProviderAccount[]>;

  /**
   * Transactions for one account, in the shape the import pipeline already consumes.
   * Throws `ConsentExpiredError` once the consent lapses.
   */
  fetchTransactions(accountRef: string, since?: Date): Promise<BankRow[]>;

  /**
   * Read-only self-check for the operator. Optional: a provider that cannot introspect its own
   * registration simply does not offer one, and the UI says so rather than showing a button that
   * can only report "unknown".
   *
   * Must never throw for a configuration problem — that IS the result. Reserve throwing for a
   * genuine fault in the check itself.
   */
  diagnose?(expectedRedirectUrl: string | null): Promise<ProviderDiagnostics>;
}
