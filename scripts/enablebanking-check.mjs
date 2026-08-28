#!/usr/bin/env node
/**
 * Record what Enable Banking's API actually returns.
 *
 * The adapter was written against Enable Banking's published sample, so the endpoints, the JWT
 * claim set and the consent flow are known. What is NOT known is the exact shape of a transaction:
 * whether the sign lives in `credit_debit_indicator` or in the amount, what `remittance_information`
 * looks like in practice, which fields a Portuguese or Spanish ASPSP actually populates.
 * `mapTransaction` handles both conventions defensively, but "handles both" is not "verified", and
 * a sign error there mis-matches rent silently rather than failing.
 *
 * This script replaces that guess with a recording. It never writes to the app's database and
 * never mutates anything at the provider — it reads, redacts, and prints.
 *
 *   ENABLE_BANKING_APPLICATION_ID=… ENABLE_BANKING_PRIVATE_KEY_FILE=/path/to/app.pem \
 *     node scripts/enablebanking-check.mjs --country PT
 *
 * `ENABLE_BANKING_PRIVATE_KEY` still works for a quick local run, but the file is what a real
 * deployment uses — a PEM is too long for some config fields, and an env var holding a private key
 * is readable from /proc/<pid>/environ besides.
 *
 * Add `--session <session_id>` to record accounts and transactions from a consent you already
 * completed in the app; without it the script stops after listing ASPSPs, which needs no consent.
 *
 * REDACTION IS THE POINT. Every value that could identify a person or an account is replaced
 * before anything is printed: IBANs, names, amounts, tokens, the key itself. The output is safe to
 * paste into an issue or a chat, which is what makes it useful for fixing the mapping.
 */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";

const API_BASE =
  process.env.ENABLE_BANKING_API_BASE?.replace(/\/+$/, "") ?? "https://api.enablebanking.com";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const COUNTRY = (opt("country", "PT") ?? "PT").toUpperCase();
const SESSION_ID = opt("session", null);

/**
 * Whether the last failed response carried a JSON body. Kept out of band rather than folded
 * into `call()`'s return value so every consumer can keep its plain `if (!x) return;` — a
 * sentinel object would have made three of them treat a failure as success.
 */
let lastFailureWasJson = true;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function buildJwt() {
  const applicationId = process.env.ENABLE_BANKING_APPLICATION_ID?.trim();
  const keyFile = process.env.ENABLE_BANKING_PRIVATE_KEY_FILE?.trim();
  const inline = process.env.ENABLE_BANKING_PRIVATE_KEY?.trim();

  if (!applicationId || (!keyFile && !inline)) {
    console.error(
      "Set ENABLE_BANKING_APPLICATION_ID, plus one of:\n" +
        "  ENABLE_BANKING_PRIVATE_KEY_FILE=/path/to/<app-id>.pem   (what a deployment uses)\n" +
        '  ENABLE_BANKING_PRIVATE_KEY="$(cat <app-id>.pem)"        (fine for a local run)',
    );
    process.exit(2);
  }

  // Same precedence as the adapter: the file wins, so this script cannot pass where the app fails.
  let privateKey;
  if (keyFile) {
    try {
      privateKey = readFileSync(keyFile, "utf8").trim();
    } catch (error) {
      console.error(
        `Could not read ENABLE_BANKING_PRIVATE_KEY_FILE "${keyFile}": ${error.message}`,
      );
      process.exit(2);
    }
  } else {
    privateKey = inline.includes("-----BEGIN")
      ? inline
      : Buffer.from(inline, "base64").toString("utf8");
  }

  const iat = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: applicationId }));
  const payload = base64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${base64url(signature)}`;
}

/**
 * Replace values, keep keys. The keys are the whole point — they are what the mapping is written
 * against — and the values are exactly what must never leave the machine.
 */
const SENSITIVE_KEYS =
  /^(iban|bban|pan|masked_pan|msisdn|name|display_name|owner_name|address|street|city|post_code|email|phone|access_token|refresh_token|code|session_id|psu_id)$/i;

function redact(value, key = "") {
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value === "string") {
    if (SENSITIVE_KEYS.test(key)) return `<${key}:${value.length} chars>`;
    // An amount tells you what someone paid; its FORMAT is what the mapping needs.
    if (/^-?\d+([.,]\d+)?$/.test(value))
      return `<numeric:${value.includes("-") ? "signed" : "unsigned"}>`;
    if (/[A-Z]{2}\d{2}[A-Z0-9]{10,}/.test(value)) return "<iban-like>";
    return value.length > 60 ? `<text:${value.length} chars>` : value;
  }
  if (typeof value === "number") return "<number>";
  return value;
}

async function call(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${buildJwt()}`, Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) {
    // The body may quote the request back, so it is redacted like everything else.
    let parsed;
    let isJson = true;
    try {
      parsed = redact(JSON.parse(text));
    } catch {
      isJson = false;
      parsed = `<non-json body, ${text.length} chars>`;
    }
    console.error(`✖ ${path} → HTTP ${response.status}`, JSON.stringify(parsed));
    // Enable Banking's API answers JSON, including for its errors. A non-JSON body is therefore
    // something between here and them — an egress proxy, a captive portal, a firewall's block
    // page — and saying "check your credentials" then sends the operator to audit a key that was
    // never the problem. Verified: from a sandbox whose allowlist rejects the CONNECT, this
    // returns exactly a 403 with a 108-character non-JSON body.
    if (!isJson) {
      console.error(
        `\n⚠ That body is not JSON, and this API answers JSON even when it refuses you — so the\n` +
          `  ${response.status} came from something between this machine and Enable Banking rather than\n` +
          `  from Enable Banking. Check for an egress proxy or firewall allowing ${new URL(API_BASE).host}\n` +
          `  before touching the application id or the key.`,
      );
    }
    lastFailureWasJson = isJson;
    return null;
  }
  return JSON.parse(text);
}

async function main() {
  console.log(`Enable Banking contract check — ${API_BASE}\n`);

  const app = await call("/application");
  if (!app) {
    // Only claim an auth problem when the provider actually answered. A non-JSON body means the
    // request never reached them, and the note above has already said so.
    if (lastFailureWasJson) {
      console.error(
        "\nThe /application call failed. That is an authentication problem rather than a data one:\n" +
          "check the application id matches the key, and that the key is the one downloaded for it.",
      );
    }
    process.exit(1);
  }
  console.log("/application →", JSON.stringify(redact(app), null, 2));
  console.log(
    "\n^ `redirect_urls` must contain your callback exactly:\n" +
      "  <NEXTAUTH_URL>/api/bank/connections/callback\n",
  );

  const aspsps = await call("/aspsps");
  if (aspsps) {
    const inCountry = (aspsps.aspsps ?? []).filter(
      (a) => (a.country ?? "").toUpperCase() === COUNTRY,
    );
    console.log(
      `/aspsps → ${(aspsps.aspsps ?? []).length} total, ${inCountry.length} in ${COUNTRY}`,
    );
    console.log(
      "First few in country:",
      JSON.stringify(
        inCountry.slice(0, 5).map((a) => ({ name: a.name, country: a.country })),
        null,
        2,
      ),
    );
    // Which countries the application actually reaches, always — not only when the asked-for
    // one is empty. A sandbox application returns the Mock ASPSPs its operator configured, and
    // those are frequently registered outside PT/ES; "0 in PT" on its own sends you looking at
    // Portugal, which is never the cause. The breakdown answers "where are my banks" directly.
    const byCountry = new Map();
    for (const a of aspsps.aspsps ?? []) {
      const c = (a.country ?? "??").toUpperCase();
      byCountry.set(c, (byCountry.get(c) ?? 0) + 1);
    }
    if (byCountry.size > 0) {
      console.log(
        "Reachable by country:",
        [...byCountry.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([c, n]) => `${c}=${n}`)
          .join(" "),
      );
    }

    if (inCountry.length === 0) {
      const elsewhere = [...byCountry.keys()].filter((c) => c !== COUNTRY);
      console.log(
        `\n⚠ No ASPSP listed for ${COUNTRY}.` +
          (elsewhere.length
            ? ` Your application does reach ${elsewhere.join(", ")} — re-run with --country ${elsewhere[0]}.\n` +
              `  Note the app's own bank picker only offers PT and ES (COUNTRIES in\n` +
              `  components/features/settings/bank-connect-panel.tsx), so a sandbox bank registered\n` +
              `  elsewhere is reachable by the API but not selectable in the UI.`
            : ` The application reaches no ASPSPs at all — a production application that has not\n` +
              `  been activated returns an empty list, and a sandbox one returns only the Mock\n` +
              `  ASPSPs configured for it in the Control Panel.`),
      );
    }
  }

  if (!SESSION_ID) {
    console.log(
      "\nNo --session given, so stopping here. Connect a bank in the app, then re-run with\n" +
        "  --session <session_id>\n" +
        "to record the account and transaction shapes, which is the part the mapping needs.",
    );
    return;
  }

  const session = await call(`/sessions/${encodeURIComponent(SESSION_ID)}`);
  if (!session) return;
  console.log("\n/sessions/{id} →", JSON.stringify(redact(session), null, 2));

  const uid = (session.accounts ?? [])[0]?.uid;
  if (!uid) {
    console.log("\nNo account uid in the session — nothing further to record.");
    return;
  }

  const transactions = await call(`/accounts/${encodeURIComponent(uid)}/transactions`);
  if (!transactions) return;

  const sample = (transactions.transactions ?? []).slice(0, 3);
  console.log(
    `\n/accounts/{uid}/transactions → ${(transactions.transactions ?? []).length} rows` +
      `${transactions.continuation_key ? " (more pages follow)" : ""}`,
  );
  console.log("Redacted sample:", JSON.stringify(redact(sample), null, 2));
  console.log(
    "\nThis sample is what `mapTransaction` should be tested against. The fields that matter:\n" +
      "  - is there a `credit_debit_indicator`, and is `transaction_amount.amount` signed?\n" +
      "  - is `remittance_information` a string or an array?\n" +
      "  - which of creditor / debtor / *_account are populated for money in vs money out?",
  );
}

main().catch((error) => {
  console.error("✖ Unexpected failure:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
