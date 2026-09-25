import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  EnableBankingConfigError,
  resetKeyCache,
  buildAuthJwt,
  decodeInstitutionId,
  enableBankingProvider,
  encodeInstitutionId,
  isEnableBankingConfigured,
  mapTransaction,
  type EnableBankingTransaction,
} from "./enablebanking";

/** A throwaway keypair. Signing is verified against the public half, so the test proves the JWT
 * is genuinely signed rather than merely well-shaped. */
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const APP_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function configure(key: string = privateKey) {
  process.env.ENABLE_BANKING_APPLICATION_ID = APP_ID;
  process.env.ENABLE_BANKING_PRIVATE_KEY = key;
}

function clearEnv() {
  delete process.env.ENABLE_BANKING_APPLICATION_ID;
  delete process.env.ENABLE_BANKING_PRIVATE_KEY;
  delete process.env.ENABLE_BANKING_PRIVATE_KEY_FILE;
  delete process.env.ENABLE_BANKING_API_BASE;
  // The key is memoised, so a case that did not reset it would be handed the previous one.
  resetKeyCache();
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("configuration", () => {
  it("is unconfigured until both the application id and the key are present", () => {
    expect(isEnableBankingConfigured()).toBe(false);

    process.env.ENABLE_BANKING_APPLICATION_ID = APP_ID;
    expect(isEnableBankingConfigured()).toBe(false);

    process.env.ENABLE_BANKING_PRIVATE_KEY = privateKey;
    expect(isEnableBankingConfigured()).toBe(true);
  });

  it("accepts the key base64-encoded, for env fields that mangle multi-line values", () => {
    // TrueNAS' app config is one such surface. Detected rather than configured — a PEM always
    // announces itself with its BEGIN line.
    configure(Buffer.from(privateKey).toString("base64"));
    expect(isEnableBankingConfigured()).toBe(true);
    expect(() => buildAuthJwt()).not.toThrow();
  });
});

describe("the authorization JWT", () => {
  it("is signed by the application's own key, and verifies against its public half", () => {
    configure();
    const [header, payload, signature] = buildAuthJwt().split(".");

    const ok = crypto
      .createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));

    expect(ok).toBe(true);
  });

  it("carries the exact claims the API expects", () => {
    // A wrong `aud` or a missing `kid` comes back as an opaque 401 from the far end, which is
    // undiagnosable from the outside. Pinning them here is the only place it is cheap to catch.
    configure();
    const now = new Date("2026-08-20T10:00:00.000Z");
    const [rawHeader, rawPayload] = buildAuthJwt(now).split(".");

    const header = JSON.parse(Buffer.from(rawHeader, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(rawPayload, "base64url").toString("utf8"));

    expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: APP_ID });
    expect(payload.iss).toBe("enablebanking.com");
    expect(payload.aud).toBe("api.enablebanking.com");
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(payload.exp).toBe(payload.iat + 3600);
  });

  it("refuses to sign when unconfigured rather than emitting an unsigned token", () => {
    expect(() => buildAuthJwt()).toThrow(/not configured/i);
  });
});

describe("institution ids", () => {
  it("round-trips a country and an ASPSP name", () => {
    // An ASPSP is addressed by {name, country}, not an opaque id, and `ConsentRequest` carries no
    // country field — so the pair travels packed inside the id the picker round-trips.
    const id = encodeInstitutionId("pt", "Banco BPI");
    expect(id).toBe("PT:Banco BPI");
    expect(decodeInstitutionId(id)).toEqual({ country: "PT", name: "Banco BPI" });
  });

  it("keeps names containing spaces and punctuation intact", () => {
    const id = encodeInstitutionId("ES", "Banco Bilbao Vizcaya Argentaria, S.A.");
    expect(decodeInstitutionId(id).name).toBe("Banco Bilbao Vizcaya Argentaria, S.A.");
  });

  it("rejects an id that is not in the expected form", () => {
    expect(() => decodeInstitutionId("BancoBPI")).toThrow();
    expect(() => decodeInstitutionId(":no-country")).toThrow();
  });
});

describe("reading the key from a file", () => {
  let dir: string;
  let keyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "situs-eb-key-"));
    keyPath = path.join(dir, "app.pem");
    writeFileSync(keyPath, privateKey, { mode: 0o400 });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("signs with a key mounted as a file", () => {
    // The documented route for a real deployment: an RSA-2048 PEM is ~1,700 characters and does
    // not fit in a TrueNAS app-config value, and an env var holding a private key is readable
    // from /proc/<pid>/environ besides.
    process.env.ENABLE_BANKING_APPLICATION_ID = APP_ID;
    process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = keyPath;

    expect(isEnableBankingConfigured()).toBe(true);

    const [header, payload, signature] = buildAuthJwt().split(".");
    const ok = crypto
      .createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });

  it("prefers the file over an inline value when both are set", () => {
    // Otherwise a leftover inline variable would quietly win over the file someone just mounted,
    // and the symptom would be an unexplained 401 from the far end.
    const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    process.env.ENABLE_BANKING_APPLICATION_ID = APP_ID;
    process.env.ENABLE_BANKING_PRIVATE_KEY = otherKey;
    process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = keyPath;

    const [header, payload, signature] = buildAuthJwt().split(".");
    // Verifies against the FILE's public half, so the file is demonstrably the one that signed.
    const ok = crypto
      .createVerify("RSA-SHA256")
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });

  it("reports an unreadable path as a configuration error naming the path", () => {
    // Not "unconfigured". A misconfigured instance that looks identical to one deliberately
    // left without a bank feed is the failure this whole session keeps running into.
    process.env.ENABLE_BANKING_APPLICATION_ID = APP_ID;
    process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = path.join(dir, "does-not-exist.pem");

    expect(() => isEnableBankingConfigured()).toThrow(EnableBankingConfigError);
    expect(() => isEnableBankingConfigured()).toThrow(/does-not-exist\.pem/);
  });

  it("rejects an empty key file rather than reporting it configured", () => {
    process.env.ENABLE_BANKING_APPLICATION_ID = APP_ID;
    const empty = path.join(dir, "empty.pem");
    writeFileSync(empty, "   \n");
    process.env.ENABLE_BANKING_PRIVATE_KEY_FILE = empty;

    expect(() => isEnableBankingConfigured()).toThrow(/empty/i);
  });

  it("explains a key whose newlines were lost, rather than passing OpenSSL's wording on", () => {
    // `error:1E08010C:DECODER routines::unsupported` is what a PEM pasted into a single-line
    // field looks like, and it tells someone who has not seen it before nothing at all.
    process.env.ENABLE_BANKING_APPLICATION_ID = APP_ID;
    process.env.ENABLE_BANKING_PRIVATE_KEY = privateKey.replace(/\n/g, " ");

    expect(() => buildAuthJwt()).toThrow(EnableBankingConfigError);
    expect(() => buildAuthJwt()).toThrow(/newlines were probably lost/i);
  });
});

/**
 * `listInstitutions` had NO coverage until an empty picker in production sent five messages
 * back and forth to diagnose. The fixture below encodes the documented `{name, country}` shape
 * — Enable Banking's own sample addresses an ASPSP that way (`ASPSP_NAME`/`ASPSP_COUNTRY`) and
 * `pprint`s the /aspsps response without reading a field, so the RESPONSE shape is still an
 * inference rather than a recording. Same standing as `mapTransaction`'s fixtures below, and
 * replaced the same way: by `scripts/enablebanking-check.mjs` run against a real application.
 */
describe("listing institutions", () => {
  const aspsps = [
    { name: "Banco BPI", country: "PT" },
    { name: "Caixa Geral de Depósitos", country: "PT", logo: "https://example.invalid/cgd.png" },
    { name: "BBVA", country: "ES" },
    { name: "Nordea", country: "FI" },
    { name: "", country: "PT" },
  ];

  function respondWith(body: unknown, ok = true) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as Response);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns only the requested country, and counts everything reachable", async () => {
    configure();
    respondWith({ aspsps });

    const listing = await enableBankingProvider.listInstitutions("pt");

    expect(listing.institutions.map((i) => i.name)).toEqual([
      "Banco BPI",
      "Caixa Geral de Depósitos",
    ]);
    // Counted BEFORE the filter. This is the whole point: 5 reachable, 2 here. Filtered, it
    // would restate institutions.length and answer nothing.
    expect(listing.totalAvailable).toBe(5);
  });

  it("reports zero reachable when the application can see nothing", async () => {
    // A sandbox application with no ASPSPs, or a production one not yet activated. The UI shows
    // a different message for this than for "reachable, none here", because the remedy differs.
    configure();
    respondWith({ aspsps: [] });

    const listing = await enableBankingProvider.listInstitutions("PT");
    expect(listing.institutions).toEqual([]);
    expect(listing.totalAvailable).toBe(0);
  });

  it("distinguishes reachable-but-elsewhere from reachable-nothing", async () => {
    // The case that actually happened: a sandbox application whose banks are Nordic, asked for
    // Portugal. Empty list, but NOT an empty provider — and saying "no banks in Portugal" points
    // at the country, which was never the cause.
    configure();
    respondWith({ aspsps: [{ name: "Nordea", country: "FI" }] });

    const listing = await enableBankingProvider.listInstitutions("PT");
    expect(listing.institutions).toEqual([]);
    expect(listing.totalAvailable).toBe(1);
  });

  it("drops a nameless ASPSP rather than offering a blank row", async () => {
    configure();
    respondWith({ aspsps });

    const listing = await enableBankingProvider.listInstitutions("PT");
    expect(listing.institutions.every((i) => i.name.length > 0)).toBe(true);
  });

  it("packs country and name into an id the consent flow can decode", async () => {
    configure();
    respondWith({ aspsps });

    const [first] = (await enableBankingProvider.listInstitutions("PT")).institutions;
    expect(decodeInstitutionId(first.id)).toEqual({ country: "PT", name: "Banco BPI" });
    expect(first.logoUrl).toBeUndefined();
  });

  it("survives a response with no aspsps key at all", async () => {
    configure();
    respondWith({});

    const listing = await enableBankingProvider.listInstitutions("PT");
    expect(listing).toEqual({ institutions: [], totalAvailable: 0 });
  });
});

/**
 * These fixtures encode assumptions about the transaction payload, NOT a recording. Enable
 * Banking's own published sample prints transactions without showing their shape, so the field
 * names come from their API reference and the sign convention is handled both ways rather than
 * guessed one way. `scripts/enablebanking-check.mjs` exists to replace this with a recording.
 */
describe("mapping a transaction", () => {
  const base: EnableBankingTransaction = {
    booking_date: "2026-08-01",
    transaction_amount: { amount: "750.00", currency: "EUR" },
  };

  it("treats CRDT as money in and reads the debtor as the counterparty", () => {
    const row = mapTransaction({
      ...base,
      credit_debit_indicator: "CRDT",
      debtor: { name: "Ana Silva" },
      debtor_account: { iban: "PT50000201239999999999999" },
      remittance_information: ["RENDA", "AGOSTO"],
    });

    expect(row?.amount).toBe(750);
    expect(row?.counterpartyName).toBe("Ana Silva");
    expect(row?.counterpartyIban).toBe("PT50000201239999999999999");
    // The array form is joined rather than dropped: PT and ES banks split references across it
    // about as often as they use a single string.
    expect(row?.reference).toBe("RENDA AGOSTO");
  });

  it("treats DBIT as money out and reads the creditor as the counterparty", () => {
    const row = mapTransaction({
      ...base,
      transaction_amount: { amount: "120.50", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      creditor: { name: "EDP Comercial" },
      remittance_information: "FATURA LUZ",
    });

    expect(row?.amount).toBe(-120.5);
    expect(row?.counterpartyName).toBe("EDP Comercial");
    expect(row?.reference).toBe("FATURA LUZ");
  });

  it("normalises an amount whose sign contradicts the indicator", () => {
    // Some ASPSPs send a signed amount AND an indicator. The indicator is the authority; taking
    // the sign on trust would flip a payment into a charge, which mis-matches rent silently.
    const row = mapTransaction({
      ...base,
      transaction_amount: { amount: "-750.00", currency: "EUR" },
      credit_debit_indicator: "CRDT",
    });
    expect(row?.amount).toBe(750);
  });

  it("honours a signed amount when no indicator is present", () => {
    const row = mapTransaction({
      ...base,
      transaction_amount: { amount: "-42.00", currency: "EUR" },
    });
    expect(row?.amount).toBe(-42);
  });

  it("falls back to the value date when the booking date is absent", () => {
    const row = mapTransaction({
      transaction_amount: { amount: "10.00" },
      value_date: "2026-08-05",
    });
    expect(row?.bookingDate).toBe("2026-08-05");
  });

  it("drops a row with no amount or no date rather than importing a broken one", () => {
    // A fingerprint built from undefined would collide with every other broken row, quietly
    // deduping unrelated movements into one.
    expect(mapTransaction({ booking_date: "2026-08-01" })).toBeNull();
    expect(mapTransaction({ transaction_amount: { amount: "10.00" } })).toBeNull();
    expect(
      mapTransaction({ booking_date: "2026-08-01", transaction_amount: { amount: "abc" } }),
    ).toBeNull();
  });

  it("falls back to the other party when a bank populates only one side", () => {
    const row = mapTransaction({
      ...base,
      credit_debit_indicator: "CRDT",
      creditor: { name: "Only Side Given" },
    });
    expect(row?.counterpartyName).toBe("Only Side Given");
  });
});
