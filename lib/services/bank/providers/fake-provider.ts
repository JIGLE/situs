/**
 * A `BankDataProvider` that talks to nothing, for tests.
 *
 * The pipeline this repo cares about — consent scoping, the daily read budget, fingerprint
 * dedupe, the IBAN encrypted at rest and matched on a hash — belongs to `consent.ts`, `sync.ts`
 * and `import.ts`, not to any vendor. Those properties used to be exercised *through* the one
 * shipped adapter, which conflated the two: a test could go red because a vendor changed its
 * JSON, and a vendor swap meant rewriting tests that were never about the vendor.
 *
 * This is deliberately in `lib/` rather than a test folder: it implements the published contract,
 * so it fails to compile the moment the contract gains a member an adapter must provide. A fake
 * that silently drifts from the interface it stands in for is worse than no fake.
 */

import type { BankRow } from "../rows";
import type {
  BankDataProvider,
  ConsentGrant,
  ConsentLink,
  ConsentRequest,
  Institution,
  InstitutionListing,
  ProviderAccount,
  RevocationResult,
} from "./types";

export interface FakeProviderOptions {
  key?: string;
  displayName?: string;
  configured?: boolean;
  dailyReadBudget?: number;
  institutions?: Institution[];
  accounts?: ProviderAccount[];
  transactions?: BankRow[];
  /** What `revokeConsent` answers; an Error is thrown, as a refused revocation would be. */
  revokeResult?: RevocationResult | Error;
}

export interface FakeProvider extends BankDataProvider {
  /** Every `fetchTransactions` call, so a test can assert the budget was respected. */
  readonly fetchCalls: { accountRef: string; since?: Date }[];
  readonly consentRequests: ConsentRequest[];
  /** Every consent id `revokeConsent` was asked to end, in order. */
  readonly revocations: string[];
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const {
    key = "fake",
    displayName = "Fake Bank",
    configured = true,
    dailyReadBudget = 4,
    institutions = [{ id: "FAKEBANK_PT", name: "Fake Bank", country: "PT" }],
    accounts = [{ id: "acct-remote-1", iban: "PT50000201231234567890154", label: "Current" }],
    transactions = [],
    revokeResult = "revoked",
  } = options;

  const fetchCalls: { accountRef: string; since?: Date }[] = [];
  const consentRequests: ConsentRequest[] = [];
  const revocations: string[] = [];
  let completions = 0;

  return {
    key,
    displayName,
    dailyReadBudget,
    isConfigured: () => configured,
    fetchCalls,
    consentRequests,
    revocations,

    async listInstitutions(country: string): Promise<InstitutionListing> {
      return {
        institutions: institutions.filter((i) => i.country === country.toUpperCase()),
        // The whole configured set, not the filtered one — the fake has to model the real
        // provider's distinction or a test could not exercise the "reachable, none here" case.
        totalAvailable: institutions.length,
      };
    },

    async createConsentLink(request: ConsentRequest): Promise<ConsentLink> {
      consentRequests.push(request);
      return {
        providerRef: `ref-${consentRequests.length}`,
        url: `https://fake-bank.test/authorise?ref=${request.reference}`,
        expiresAt: null,
      };
    },

    // A new consent id per completion, the way Enable Banking mints its session id only when
    // the user comes back from the bank.
    async completeConsent(): Promise<ConsentGrant> {
      completions += 1;
      return { accounts, providerRef: `session-${completions}` };
    },

    async revokeConsent({ providerRef }): Promise<RevocationResult> {
      revocations.push(providerRef);
      if (revokeResult instanceof Error) throw revokeResult;
      return revokeResult;
    },

    async fetchTransactions(accountRef: string, since?: Date): Promise<BankRow[]> {
      fetchCalls.push({ accountRef, since });
      return transactions;
    },
  };
}
