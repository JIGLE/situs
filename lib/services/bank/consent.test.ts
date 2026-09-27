import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, providerMock, configuredMock, revokeMock } = vi.hoisted(() => ({
  prismaMock: {
    bankConnection: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    bankAccount: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { findFirst: vi.fn() },
  },
  providerMock: {
    key: "fake",
    createConsentLink: vi.fn(),
    completeConsent: vi.fn(),
    listInstitutions: vi.fn(),
  },
  configuredMock: vi.fn(),
  revokeMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/utils/pii-encryption", () => ({ encryptPII: (v: string) => `enc:${v}` }));
vi.mock("./import", () => ({ hashIban: (v: string) => `hash:${v.replace(/\s/g, "")}` }));
vi.mock("./connections", () => ({ revokeAtBank: revokeMock }));
vi.mock("./providers/registry", () => ({
  PSD2_PREFIX: "psd2_",
  configuredProviders: configuredMock,
  getBankProvider: () => providerMock,
  getProviderForConnection: (column: string) =>
    column.startsWith("psd2_") ? providerMock : undefined,
  providerColumnValue: (key: string) => `psd2_${key}`,
}));

import { startConsent, startRenewal, completeConsent, ConsentFlowError } from "./consent";
import { logAudit } from "@/lib/services/audit-log";
import { ResourceNotFoundError } from "@/lib/utils/error-handling";

const REFERENCE = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://situs.example.com";
  configuredMock.mockReturnValue(["fake"]);
  prismaMock.bankConnection.create.mockResolvedValue({ id: "conn-1" });
  prismaMock.bankConnection.update.mockResolvedValue({});
  prismaMock.bankConnection.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.bankConnection.findUnique.mockResolvedValue({ metadata: null });
  prismaMock.bankAccount.findFirst.mockResolvedValue(null);
  prismaMock.bankAccount.findMany.mockResolvedValue([]);
  prismaMock.bankAccount.create.mockResolvedValue({ id: "acct-1" });
  prismaMock.bankAccount.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.auditLog.findFirst.mockResolvedValue(null);
  revokeMock.mockResolvedValue("revoked");
  providerMock.createConsentLink.mockResolvedValue({
    providerRef: "req-1",
    url: "https://bank.example/authorise",
    expiresAt: new Date("2026-11-12T00:00:00.000Z"),
  });
  providerMock.completeConsent.mockResolvedValue({ accounts: [], providerRef: null });
});

describe("starting a consent", () => {
  it("creates the pending row before leaving for the bank", async () => {
    // The reference must have something to come back to; if the provider call then fails, an
    // unfinished attempt is visible rather than silently lost.
    await startConsent("user-1", {
      country: "PT",
      institutionId: "BANCOBPI_BBPIPTPL",
      institutionName: "Banco BPI",
      providerKey: "fake",
    });

    const created = prismaMock.bankConnection.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      userId: "user-1",
      provider: "psd2_fake",
      status: "pending_consent",
    });
    expect(prismaMock.bankConnection.create.mock.invocationCallOrder[0]).toBeLessThan(
      providerMock.createConsentLink.mock.invocationCallOrder[0],
    );
  });

  it("keeps the bank's id, so the connection can be renewed later", async () => {
    await startConsent("user-1", {
      country: "PT",
      institutionId: "BANCOBPI_BBPIPTPL",
      institutionName: "Banco BPI",
      providerKey: "fake",
    });

    const metadata = JSON.parse(prismaMock.bankConnection.create.mock.calls[0][0].data.metadata);
    expect(metadata.institutionId).toBe("BANCOBPI_BBPIPTPL");
  });

  it("mints an unguessable reference", async () => {
    await startConsent("user-1", {
      country: "PT",
      institutionId: "X",
      institutionName: "Bank",
      providerKey: "fake",
    });

    const { reference } = JSON.parse(
      prismaMock.bankConnection.create.mock.calls[0][0].data.metadata,
    );
    // 32 bytes hex. A short or sequential reference would make the callback forgeable.
    expect(reference).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses when no provider is configured on this instance", async () => {
    configuredMock.mockReturnValue([]);

    await expect(
      startConsent("user-1", {
        country: "PT",
        institutionId: "X",
        institutionName: "Bank",
        providerKey: "fake",
      }),
    ).rejects.toBeInstanceOf(ConsentFlowError);
    expect(prismaMock.bankConnection.create).not.toHaveBeenCalled();
  });

  it("refuses a provider this instance is not configured for", async () => {
    // `startConsent` used to do `const [providerKey] = configuredProviders()` — first-wins, so a
    // caller asking for one provider silently got whichever sorted first. Rejecting is the only
    // honest answer; quietly consenting through a different bank data provider is not.
    configuredMock.mockReturnValue(["alpha", "zulu"]);
    await expect(
      startConsent("user-1", {
        country: "PT",
        institutionId: "X",
        institutionName: "Bank",
        providerKey: "not-installed",
      }),
    ).rejects.toBeInstanceOf(ConsentFlowError);
    expect(prismaMock.bankConnection.create).not.toHaveBeenCalled();
  });

  it("refuses without a base URL to bring the user back to", async () => {
    delete process.env.NEXTAUTH_URL;

    await expect(
      startConsent("user-1", {
        country: "PT",
        institutionId: "X",
        institutionName: "Bank",
        providerKey: "fake",
      }),
    ).rejects.toThrow(/NEXTAUTH_URL/);
  });
});

/**
 * The callback is a plain GET the bank redirects the user's browser to. Anyone can navigate to it
 * with any query string, so all three guards below are load-bearing.
 */
describe("completing a consent", () => {
  function pending(overrides: Record<string, unknown> = {}) {
    return {
      id: "conn-1",
      userId: "user-1",
      provider: "psd2_fake",
      institutionName: "Banco BPI",
      status: "pending_consent",
      consentId: "req-1",
      metadata: JSON.stringify({ reference: REFERENCE }),
      // Minted an hour ago: well inside the day a reference lasts.
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      ...overrides,
    };
  }

  it("activates the connection when the reference matches", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);

    await expect(completeConsent("user-1", REFERENCE)).resolves.toMatchObject({
      connectionId: "conn-1",
    });
    expect(prismaMock.bankConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active" }) }),
    );
  });

  it("stores the consent id the provider mints at completion, so it can be revoked", async () => {
    // Enable Banking mints its session id only when the user comes back; it used to be dropped.
    prismaMock.bankConnection.findMany.mockResolvedValue([pending({ consentId: null })]);
    providerMock.completeConsent.mockResolvedValue({ accounts: [], providerRef: "session-9" });

    await completeConsent("user-1", REFERENCE);

    expect(prismaMock.bankConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { status: "active", consentId: "session-9" },
    });
  });

  it("keeps a consent id minted at consent-start when completion mints none", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending({ consentId: "req-1" })]);

    await completeConsent("user-1", REFERENCE);

    expect(prismaMock.bankConnection.update).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { status: "active", consentId: "req-1" },
    });
  });

  it("only ever looks at the caller's own connections", async () => {
    // Asserted on the query: a reference lifted from someone else's redirect must not resolve,
    // and comparing ownership after an unscoped fetch would still be an IDOR.
    prismaMock.bankConnection.findMany.mockResolvedValue([]);

    await expect(completeConsent("user-2", REFERENCE)).rejects.toBeInstanceOf(ConsentFlowError);
    expect(prismaMock.bankConnection.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-2",
    });
  });

  it("rejects a reference that does not match the stored one", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);

    await expect(completeConsent("user-1", "b".repeat(64))).rejects.toBeInstanceOf(
      ConsentFlowError,
    );
    expect(providerMock.completeConsent).not.toHaveBeenCalled();
  });

  it("cannot be replayed: an activated connection's first reference is never matched", async () => {
    // Even were the spent reference still on the row, a live row is matched only by a parked
    // renewal, so a second visit to the same callback URL finds nothing.
    prismaMock.bankConnection.findMany.mockResolvedValue([pending({ status: "active" })]);

    await expect(completeConsent("user-1", REFERENCE)).rejects.toThrow(/no longer valid/i);
    expect(providerMock.completeConsent).not.toHaveBeenCalled();
  });

  it("refuses a reference older than a day, before calling the bank", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      pending({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }),
    ]);

    await expect(completeConsent("user-1", REFERENCE)).rejects.toMatchObject({ status: 404 });
    expect(providerMock.completeConsent).not.toHaveBeenCalled();
  });

  it("spends the reference before calling the bank, so a second callback finds nothing", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);

    await completeConsent("user-1", REFERENCE);

    // The claim is conditional on the row as it was read, and removes the reference.
    const claim = prismaMock.bankConnection.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({
      id: "conn-1",
      userId: "user-1",
      status: "pending_consent",
      metadata: JSON.stringify({ reference: REFERENCE }),
    });
    expect(JSON.parse(claim.data.metadata).reference).toBeUndefined();
    expect(prismaMock.bankConnection.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      providerMock.completeConsent.mock.invocationCallOrder[0],
    );
  });

  it("answers the callback that lost the race like a replay, without calling the bank", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);
    prismaMock.bankConnection.updateMany.mockResolvedValue({ count: 0 });

    await expect(completeConsent("user-1", REFERENCE)).rejects.toMatchObject({ status: 404 });
    expect(providerMock.completeConsent).not.toHaveBeenCalled();
  });

  it("gives the same answer for unknown, replayed and foreign references", async () => {
    // Distinguishing them would confirm a valid reference to whoever guessed it.
    prismaMock.bankConnection.findMany.mockResolvedValue([]);
    const unknown = await completeConsent("user-1", REFERENCE).catch((e) => e.message);

    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);
    const wrong = await completeConsent("user-1", "c".repeat(64)).catch((e) => e.message);

    expect(unknown).toBe(wrong);
  });

  it("lets a provider finish without a stored consent id", async () => {
    // This used to reject a null `consentId` as "never reached the bank". That was true for a
    // provider that mints its id when consent STARTS — and wrong for one that returns only a URL
    // and mints the id in exchange for a code on the redirect, which is the shape Enable Banking
    // uses. Whether the pieces are sufficient is the adapter's question, so it is asked there.
    prismaMock.bankConnection.findMany.mockResolvedValue([pending({ consentId: null })]);

    await expect(completeConsent("user-1", REFERENCE)).resolves.toMatchObject({
      connectionId: "conn-1",
    });
  });

  /**
   * The callback needs to know which page to send the operator back to, and it only knows because
   * `completeConsent` tells it. A test connection is begun in the control center and managed
   * there; finishing on the Settings tab would strand the operator away from the panel that lists
   * it. Reading the marker off the row it already holds is what makes that possible without a
   * second query — and a `false` that should be `true` is a silent wrong turn, not a crash.
   */
  it("reports a test connection as one", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([
      pending({ metadata: JSON.stringify({ reference: REFERENCE, isTest: true }) }),
    ]);

    await expect(completeConsent("user-1", REFERENCE)).resolves.toMatchObject({ isTest: true });
  });

  it("reports an ordinary connection as not a test", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);

    await expect(completeConsent("user-1", REFERENCE)).resolves.toMatchObject({ isTest: false });
  });

  it("hands the adapter both the stored ref and the callback's query", async () => {
    // The route passes every redirect parameter through unfiltered, because which ones matter is
    // the provider's business: one finishes from an id we already hold, another needs a
    // single-use `code` that exists nowhere else.
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);

    await completeConsent("user-1", REFERENCE, { code: "auth-code-1", state: REFERENCE });

    expect(providerMock.completeConsent).toHaveBeenCalledWith({
      providerRef: "req-1",
      callbackParams: { code: "auth-code-1", state: REFERENCE },
    });
  });

  it("encrypts the IBAN and keeps only a hash for matching", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);
    providerMock.completeConsent.mockResolvedValue({
      accounts: [{ id: "gc-1", iban: "PT50000201231234567890154", label: "Conta ordenado" }],
      providerRef: null,
    });

    await completeConsent("user-1", REFERENCE);

    const created = prismaMock.bankAccount.create.mock.calls[0][0].data;
    expect(created.iban).toBe("enc:PT50000201231234567890154");
    expect(created.ibanHash).toBe("hash:PT50000201231234567890154");
    expect(created.ibanLast4).toBe("0154");
  });

  it("updates an existing account rather than splitting its history on reconnect", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);
    prismaMock.bankAccount.findFirst.mockResolvedValue({ id: "acct-existing" });
    prismaMock.bankAccount.update.mockResolvedValue({ id: "acct-existing" });
    providerMock.completeConsent.mockResolvedValue({
      accounts: [{ id: "gc-1", iban: "PT50000201231234567890154", label: "Conta ordenado" }],
      providerRef: null,
    });

    await completeConsent("user-1", REFERENCE);

    expect(prismaMock.bankAccount.create).not.toHaveBeenCalled();
    expect(prismaMock.bankAccount.update).toHaveBeenCalled();
  });

  it("drops the spent reference and records the provider account ids", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);
    // The row still carries the reference when persistAccounts re-reads it — which is exactly
    // the case that would let a careless metadata merge carry the spent token forward.
    prismaMock.bankConnection.findUnique.mockResolvedValue({
      metadata: JSON.stringify({ reference: REFERENCE }),
    });
    providerMock.completeConsent.mockResolvedValue({
      accounts: [{ id: "gc-1", label: "Conta" }],
      providerRef: null,
    });

    await completeConsent("user-1", REFERENCE);

    const metadataWrite = prismaMock.bankConnection.update.mock.calls.find(
      (call) => typeof call[0].data.metadata === "string",
    )!;
    const metadata = JSON.parse(metadataWrite[0].data.metadata);
    // Keeping a spent reference would leave a usable token on a row that is no longer pending.
    expect(metadata.reference).toBeUndefined();
    expect(metadata.accountRefs).toEqual({ "acct-1": "gc-1" });
  });

  it("keeps a test run's marker once its consent completes", async () => {
    // Writing only the account refs used to drop `isTest`: the run then vanished from /admin and
    // its sandbox movements stopped being kept out of automatic allocation.
    prismaMock.bankConnection.findMany.mockResolvedValue([
      pending({ metadata: JSON.stringify({ reference: REFERENCE, isTest: true }) }),
    ]);
    prismaMock.bankConnection.findUnique.mockResolvedValue({
      metadata: JSON.stringify({ reference: REFERENCE, isTest: true }),
    });
    providerMock.completeConsent.mockResolvedValue({
      accounts: [{ id: "gc-1", label: "Conta" }],
      providerRef: null,
    });

    await completeConsent("user-1", REFERENCE);

    const metadataWrite = prismaMock.bankConnection.update.mock.calls.find(
      (call) => typeof call[0].data.metadata === "string",
    )!;
    expect(JSON.parse(metadataWrite[0].data.metadata)).toEqual({
      isTest: true,
      accountRefs: { "acct-1": "gc-1" },
    });
  });
});

/**
 * Renewing a connection in place. A reconnect used to be a new connection with new account rows,
 * so a movement seen through both missed exact deduplication and waited in review.
 */
describe("renewing a connection", () => {
  const RENEWAL_REF = "c".repeat(64);

  function live(overrides: Record<string, unknown> = {}) {
    return {
      id: "conn-1",
      userId: "user-1",
      provider: "psd2_fake",
      institutionName: "Banco BPI",
      status: "active",
      consentId: "session-old",
      consentExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
      metadata: JSON.stringify({
        institutionId: "BANCOBPI_BBPIPTPL",
        accountRefs: { "acct-1": "remote-old" },
      }),
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      ...overrides,
    };
  }

  function parked(overrides: Record<string, unknown> = {}) {
    const renewal = {
      reference: RENEWAL_REF,
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      providerRef: null,
      consentExpiresAt: "2027-01-01T00:00:00.000Z",
    };
    return live({
      metadata: JSON.stringify({
        institutionId: "BANCOBPI_BBPIPTPL",
        isTest: false,
        accountRefs: { "acct-1": "remote-old" },
        renewal,
      }),
      ...overrides,
    });
  }

  describe("starting", () => {
    it("scopes the lookup to the caller, and does not find another owner's connection", async () => {
      prismaMock.bankConnection.findFirst.mockResolvedValue(null);

      await expect(startRenewal("user-2", "conn-1")).rejects.toBeInstanceOf(ResourceNotFoundError);
      expect(prismaMock.bankConnection.findFirst.mock.calls[0][0].where).toEqual({
        id: "conn-1",
        userId: "user-2",
      });
    });

    it("refuses a manual connection and one whose first consent is unfinished", async () => {
      prismaMock.bankConnection.findFirst.mockResolvedValue(live({ provider: "manual" }));
      await expect(startRenewal("user-1", "conn-1")).rejects.toMatchObject({
        reason: "bank_connection_not_live",
      });

      prismaMock.bankConnection.findFirst.mockResolvedValue(live({ status: "pending_consent" }));
      await expect(startRenewal("user-1", "conn-1")).rejects.toMatchObject({
        reason: "bank_connection_not_live",
      });
      expect(providerMock.createConsentLink).not.toHaveBeenCalled();
    });

    it("refuses when the provider is not configured here", async () => {
      prismaMock.bankConnection.findFirst.mockResolvedValue(live());
      configuredMock.mockReturnValue([]);

      await expect(startRenewal("user-1", "conn-1")).rejects.toMatchObject({ status: 503 });
    });

    it("parks the new consent and changes nothing the connection works from", async () => {
      prismaMock.bankConnection.findFirst.mockResolvedValue(live());
      const now = new Date("2026-09-27T12:00:00.000Z");

      const started = await startRenewal("user-1", "conn-1", now);

      expect(started).toEqual({ connectionId: "conn-1", url: "https://bank.example/authorise" });
      expect(providerMock.createConsentLink).toHaveBeenCalledWith(
        expect.objectContaining({
          institutionId: "BANCOBPI_BBPIPTPL",
          redirectUrl: "https://situs.example.com/api/bank/connections/callback",
        }),
      );
      const write = prismaMock.bankConnection.updateMany.mock.calls[0][0];
      expect(write.where).toEqual({ id: "conn-1", userId: "user-1", metadata: live().metadata });
      // Only the metadata is written: status, consent id, expiry and account refs stay.
      expect(Object.keys(write.data)).toEqual(["metadata"]);
      const metadata = JSON.parse(write.data.metadata);
      expect(metadata.accountRefs).toEqual({ "acct-1": "remote-old" });
      expect(metadata.renewal).toMatchObject({
        startedAt: "2026-09-27T12:00:00.000Z",
        providerRef: "req-1",
        consentExpiresAt: "2026-11-12T00:00:00.000Z",
      });
      expect(metadata.renewal.reference).toMatch(/^[0-9a-f]{64}$/);
      expect(prismaMock.bankConnection.update).not.toHaveBeenCalled();
    });

    it("answers a renewal started twice at once with a conflict", async () => {
      prismaMock.bankConnection.findFirst.mockResolvedValue(live());
      prismaMock.bankConnection.updateMany.mockResolvedValue({ count: 0 });

      await expect(startRenewal("user-1", "conn-1")).rejects.toMatchObject({
        reason: "bank_connection_changed",
      });
    });

    it("finds an older connection's bank from its creation record, by exact name", async () => {
      prismaMock.bankConnection.findFirst.mockResolvedValue(
        live({ metadata: JSON.stringify({ accountRefs: {} }) }),
      );
      prismaMock.auditLog.findFirst.mockResolvedValue({
        details: JSON.stringify({ institutionName: "Banco BPI", country: "PT" }),
      });
      providerMock.listInstitutions.mockResolvedValue({
        institutions: [
          { id: "PT:Banco BPI", name: "Banco BPI", country: "PT" },
          { id: "PT:Banco CTT", name: "Banco CTT", country: "PT" },
        ],
        totalAvailable: 2,
      });

      await startRenewal("user-1", "conn-1");

      expect(providerMock.listInstitutions).toHaveBeenCalledWith("PT");
      expect(providerMock.createConsentLink).toHaveBeenCalledWith(
        expect.objectContaining({ institutionId: "PT:Banco BPI" }),
      );
      // Kept, so it is not looked up again.
      const metadata = JSON.parse(
        prismaMock.bankConnection.updateMany.mock.calls[0][0].data.metadata,
      );
      expect(metadata.institutionId).toBe("PT:Banco BPI");
    });

    it("never guesses: no record, or two banks of that name, is a refusal with a reason", async () => {
      const older = live({ metadata: JSON.stringify({ accountRefs: {} }) });
      prismaMock.bankConnection.findFirst.mockResolvedValue(older);
      await expect(startRenewal("user-1", "conn-1")).rejects.toMatchObject({
        reason: "bank_connection_renewal_unavailable",
      });

      prismaMock.auditLog.findFirst.mockResolvedValue({
        details: JSON.stringify({ country: "PT" }),
      });
      providerMock.listInstitutions.mockResolvedValue({
        institutions: [
          { id: "PT:Banco BPI:1", name: "Banco BPI", country: "PT" },
          { id: "PT:Banco BPI:2", name: "Banco BPI", country: "PT" },
        ],
        totalAvailable: 2,
      });
      await expect(startRenewal("user-1", "conn-1")).rejects.toMatchObject({
        reason: "bank_connection_renewal_unavailable",
      });
      expect(providerMock.createConsentLink).not.toHaveBeenCalled();
    });
  });

  describe("completing", () => {
    it("puts the new consent in place on the same connection, then ends the old one", async () => {
      prismaMock.bankConnection.findMany.mockResolvedValue([parked()]);
      prismaMock.bankConnection.findUnique.mockResolvedValue({ metadata: parked().metadata });
      providerMock.completeConsent.mockResolvedValue({
        accounts: [{ id: "remote-new", iban: "PT50000201231234567890154", label: "Conta" }],
        providerRef: "session-new",
      });
      prismaMock.bankAccount.findFirst.mockResolvedValue({ id: "acct-1" });
      prismaMock.bankAccount.update.mockResolvedValue({ id: "acct-1" });

      const done = await completeConsent("user-1", RENEWAL_REF);

      expect(done).toEqual({ connectionId: "conn-1", isTest: false, renewal: true });
      // The renewal is spent in the claim, conditional on the row as read.
      const claim = prismaMock.bankConnection.updateMany.mock.calls[0][0];
      expect(claim.where).toMatchObject({ id: "conn-1", status: "active" });
      expect(JSON.parse(claim.data.metadata).renewal).toBeUndefined();
      // The same account row, with the new provider id replacing the old one.
      expect(prismaMock.bankAccount.create).not.toHaveBeenCalled();
      const refsWrite = prismaMock.bankConnection.update.mock.calls.find(
        (call) => typeof call[0].data.metadata === "string",
      )!;
      expect(JSON.parse(refsWrite[0].data.metadata).accountRefs).toEqual({
        "acct-1": "remote-new",
      });
      // The new consent, and the expiry the provider gave it.
      const activate = prismaMock.bankConnection.update.mock.calls.find(
        (call) => call[0].data.status === "active",
      )!;
      expect(activate[0].data).toEqual({
        status: "active",
        consentId: "session-new",
        consentExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
      });
      // The old consent is ended only after the new one is stored.
      expect(revokeMock).toHaveBeenCalledWith("psd2_fake", "session-old");
      expect(revokeMock.mock.invocationCallOrder[0]).toBeGreaterThan(
        prismaMock.bankConnection.update.mock.invocationCallOrder.at(-1)!,
      );
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "BANK_CONSENT_RENEWED",
          details: expect.objectContaining({
            previousStatus: "active",
            previousConsent: "revoked",
          }),
        }),
      );
    });

    it("hands the adapter the renewal's own reference, not the old consent's", async () => {
      prismaMock.bankConnection.findMany.mockResolvedValue([
        parked({
          metadata: JSON.stringify({
            renewal: {
              reference: RENEWAL_REF,
              startedAt: new Date().toISOString(),
              providerRef: "req-renewal",
              consentExpiresAt: null,
            },
          }),
        }),
      ]);
      providerMock.completeConsent.mockResolvedValue({ accounts: [], providerRef: null });

      await completeConsent("user-1", RENEWAL_REF, { code: "abc" });

      expect(providerMock.completeConsent).toHaveBeenCalledWith({
        providerRef: "req-renewal",
        callbackParams: { code: "abc" },
      });
    });

    it("completes even when the old consent cannot be ended", async () => {
      prismaMock.bankConnection.findMany.mockResolvedValue([parked()]);
      providerMock.completeConsent.mockResolvedValue({ accounts: [], providerRef: "session-new" });
      revokeMock.mockResolvedValue("failed");

      await expect(completeConsent("user-1", RENEWAL_REF)).resolves.toMatchObject({
        renewal: true,
      });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ previousConsent: "failed" }),
        }),
      );
    });

    it("records that an older connection's consent was never stored, so could not be ended", async () => {
      // Connections made before the session id was kept have none: renewing one stores the new id,
      // and the old consent lapses on its own date. The record says which happened.
      prismaMock.bankConnection.findMany.mockResolvedValue([parked({ consentId: null })]);
      providerMock.completeConsent.mockResolvedValue({ accounts: [], providerRef: "session-new" });
      revokeMock.mockResolvedValue("no_consent_id");

      await completeConsent("user-1", RENEWAL_REF);

      expect(revokeMock).toHaveBeenCalledWith("psd2_fake", null);
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          details: expect.objectContaining({ previousConsent: "no_consent_id" }),
        }),
      );
    });

    it("refuses a renewal reference older than a day", async () => {
      prismaMock.bankConnection.findMany.mockResolvedValue([
        parked({
          metadata: JSON.stringify({
            renewal: {
              reference: RENEWAL_REF,
              startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
              providerRef: null,
              consentExpiresAt: null,
            },
          }),
        }),
      ]);

      await expect(completeConsent("user-1", RENEWAL_REF)).rejects.toMatchObject({ status: 404 });
      expect(providerMock.completeConsent).not.toHaveBeenCalled();
    });

    it("stops syncing an account the bank did not grant again, keeping its movements", async () => {
      prismaMock.bankConnection.findMany.mockResolvedValue([parked()]);
      providerMock.completeConsent.mockResolvedValue({
        accounts: [{ id: "remote-new", iban: "PT50000201231234567890154", label: "Conta" }],
        providerRef: "session-new",
      });
      prismaMock.bankAccount.findFirst.mockResolvedValue({ id: "acct-1" });
      prismaMock.bankAccount.update.mockResolvedValue({ id: "acct-1" });

      await completeConsent("user-1", RENEWAL_REF);

      // Deactivated, never deleted: deleting an account would cascade to its movements.
      expect(prismaMock.bankAccount.updateMany).toHaveBeenCalledWith({
        where: { connectionId: "conn-1", isActive: true, id: { notIn: ["acct-1"] } },
        data: { isActive: false },
      });
    });

    it("finds an account without an IBAN again by its name and currency", async () => {
      prismaMock.bankConnection.findMany.mockResolvedValue([parked()]);
      providerMock.completeConsent.mockResolvedValue({
        accounts: [{ id: "remote-new", label: "Poupança", currency: "EUR" }],
        providerRef: "session-new",
      });
      prismaMock.bankAccount.findMany.mockResolvedValue([{ id: "acct-7" }]);
      prismaMock.bankAccount.update.mockResolvedValue({ id: "acct-7" });

      await completeConsent("user-1", RENEWAL_REF);

      expect(prismaMock.bankAccount.findMany).toHaveBeenCalledWith({
        where: { connectionId: "conn-1", ibanHash: null, label: "Poupança", currency: "EUR" },
        select: { id: true },
      });
      expect(prismaMock.bankAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "acct-7" } }),
      );
      expect(prismaMock.bankAccount.create).not.toHaveBeenCalled();
    });

    it("keeps the test marker through a renewal", async () => {
      const metadata = JSON.stringify({
        isTest: true,
        renewal: {
          reference: RENEWAL_REF,
          startedAt: new Date().toISOString(),
          providerRef: null,
          consentExpiresAt: null,
        },
      });
      prismaMock.bankConnection.findMany.mockResolvedValue([parked({ metadata })]);
      prismaMock.bankConnection.findUnique.mockResolvedValue({
        metadata: JSON.stringify({ isTest: true }),
      });
      providerMock.completeConsent.mockResolvedValue({ accounts: [], providerRef: "s" });

      await expect(completeConsent("user-1", RENEWAL_REF)).resolves.toMatchObject({
        isTest: true,
      });
      const refsWrite = prismaMock.bankConnection.update.mock.calls.find(
        (call) => typeof call[0].data.metadata === "string",
      )!;
      expect(JSON.parse(refsWrite[0].data.metadata).isTest).toBe(true);
    });
  });
});
