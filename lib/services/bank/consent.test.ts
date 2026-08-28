import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock, providerMock, configuredMock } = vi.hoisted(() => ({
  prismaMock: {
    bankConnection: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    bankAccount: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  providerMock: { key: "fake", createConsentLink: vi.fn(), completeConsent: vi.fn() },
  configuredMock: vi.fn(),
}));

vi.mock("@/lib/services/database/database", () => ({ getPrismaClient: () => prismaMock }));
vi.mock("@/lib/services/audit-log", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/utils/pii-encryption", () => ({ encryptPII: (v: string) => `enc:${v}` }));
vi.mock("./import", () => ({ hashIban: (v: string) => `hash:${v.replace(/\s/g, "")}` }));
vi.mock("./providers/registry", () => ({
  configuredProviders: configuredMock,
  getBankProvider: () => providerMock,
  getProviderForConnection: (column: string) =>
    column.startsWith("psd2_") ? providerMock : undefined,
  providerColumnValue: (key: string) => `psd2_${key}`,
}));

import { startConsent, completeConsent, ConsentFlowError } from "./consent";

const REFERENCE = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = "https://situs.example.com";
  configuredMock.mockReturnValue(["fake"]);
  prismaMock.bankConnection.create.mockResolvedValue({ id: "conn-1" });
  prismaMock.bankConnection.update.mockResolvedValue({});
  prismaMock.bankConnection.findUnique.mockResolvedValue({ metadata: null });
  prismaMock.bankAccount.findFirst.mockResolvedValue(null);
  prismaMock.bankAccount.create.mockResolvedValue({ id: "acct-1" });
  providerMock.createConsentLink.mockResolvedValue({
    providerRef: "req-1",
    url: "https://bank.example/authorise",
    expiresAt: new Date("2026-11-12T00:00:00.000Z"),
  });
  providerMock.completeConsent.mockResolvedValue([]);
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
      ...overrides,
    };
  }

  it("activates the connection when the reference matches", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);

    await expect(completeConsent("user-1", REFERENCE)).resolves.toMatchObject({
      connectionId: "conn-1",
    });
    expect(prismaMock.bankConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "active" } }),
    );
  });

  it("only ever looks at the caller's own pending connections", async () => {
    // Asserted on the query: a reference lifted from someone else's redirect must not resolve,
    // and comparing ownership after an unscoped fetch would still be an IDOR.
    prismaMock.bankConnection.findMany.mockResolvedValue([]);

    await expect(completeConsent("user-2", REFERENCE)).rejects.toBeInstanceOf(ConsentFlowError);
    expect(prismaMock.bankConnection.findMany.mock.calls[0][0].where).toEqual({
      userId: "user-2",
      status: "pending_consent",
    });
  });

  it("rejects a reference that does not match the stored one", async () => {
    prismaMock.bankConnection.findMany.mockResolvedValue([pending()]);

    await expect(completeConsent("user-1", "b".repeat(64))).rejects.toBeInstanceOf(
      ConsentFlowError,
    );
    expect(providerMock.completeConsent).not.toHaveBeenCalled();
  });

  it("cannot be replayed, because only pending rows are queried", async () => {
    // The status filter is the single-use guard: an activated connection is not in the candidate
    // set at all, so a second visit to the same callback URL finds nothing.
    prismaMock.bankConnection.findMany.mockResolvedValue([]);

    await expect(completeConsent("user-1", REFERENCE)).rejects.toThrow(/no longer valid/i);
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
    providerMock.completeConsent.mockResolvedValue([
      { id: "gc-1", iban: "PT50000201231234567890154", label: "Conta ordenado" },
    ]);

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
    providerMock.completeConsent.mockResolvedValue([
      { id: "gc-1", iban: "PT50000201231234567890154", label: "Conta ordenado" },
    ]);

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
    providerMock.completeConsent.mockResolvedValue([{ id: "gc-1", label: "Conta" }]);

    await completeConsent("user-1", REFERENCE);

    const metadataWrite = prismaMock.bankConnection.update.mock.calls.find(
      (call) => typeof call[0].data.metadata === "string",
    )!;
    const metadata = JSON.parse(metadataWrite[0].data.metadata);
    // Keeping a spent reference would leave a usable token on a row that is no longer pending.
    expect(metadata.reference).toBeUndefined();
    expect(metadata.accountRefs).toEqual({ "acct-1": "gc-1" });
  });
});
