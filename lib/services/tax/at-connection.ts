/**
 * The owner's connection to AT: the Portal sub-user Situs signs in as, the connector's mode, and
 * the two calls that change nothing at AT, Check credentials and Fetch receipt.
 *
 * Nothing here reaches AT unless the owner has put the connector in the test mode, which needs the
 * instance's certificate files and a stored sub-user first. Production is not reachable from here
 * at all: `AT_ENDPOINTS.production` is used nowhere until going live is built.
 *
 * The sub-user's password is stored in `TaxAuthorityConnector.credentialsRef`, AES-256-GCM
 * encrypted with the PII key, and never leaves this module: the view says only whether one is
 * set. `encryptPII` writes plaintext when the key is missing, so a save checks the result and
 * refuses rather than store the password in clear; `ALLOW_UNENCRYPTED_PII` does not change that.
 */

import { getPrismaClient } from "@/lib/services/database/database";
import { logAudit } from "@/lib/services/audit-log";
import { ensureConnector, logSubmission } from "@/lib/services/tax/connector-service";
import { checkCredentials, obterRecibo, type AtOutcome } from "@/lib/tax/at/client";
import { authenticated, type AtCodeCategory } from "@/lib/tax/at/codes";
import { readAtConfig, type AtConfigStatus } from "@/lib/tax/at/config";
import type { AtFieldError } from "@/lib/tax/at/soap";
import { AT_ENDPOINTS } from "@/lib/tax/at/transport";
import type { AtLogin } from "@/lib/tax/at/ws-security";
import { TEST_MODES } from "@/lib/tax/connectors/modes";
import { PT_AT_CONNECTOR_KEY } from "@/lib/tax/connectors/pt-at";
import type { AtCredentialsInput, AtSelectableMode } from "@/lib/schemas/at-connection.schema";
import { ConflictError } from "@/lib/utils/error-handling";
import { decryptPII, encryptPII, isEncrypted } from "@/lib/utils/pii-encryption";

const COUNTRY = "PT";

/** Mode of a connector row that does not exist yet: the default `ensureConnector` creates. */
const DEFAULT_MODE = "review";

type Credentials =
  | { state: "unset" }
  /** Stored under another PII key, or damaged: it must be entered again. */
  | { state: "unreadable" }
  | { state: "set"; login: AtLogin };

function readCredentials(ref: string | null): Credentials {
  if (!ref) return { state: "unset" };
  // This module never stores the password in clear, so a value that is not encrypted was not
  // written by it and is not trusted.
  if (!isEncrypted(ref)) return { state: "unreadable" };
  try {
    const stored = JSON.parse(decryptPII(ref)) as { username?: unknown; password?: unknown };
    if (typeof stored.username === "string" && typeof stored.password === "string") {
      return { state: "set", login: { username: stored.username, password: stored.password } };
    }
  } catch {
    // decryptPII returns "[ENCRYPTED]" when it cannot decrypt, which is not JSON.
  }
  return { state: "unreadable" };
}

async function findConnector(userId: string) {
  return getPrismaClient().taxAuthorityConnector.findUnique({
    where: { userId_connectorKey: { userId, connectorKey: PT_AT_CONNECTOR_KEY } },
  });
}

export interface AtConnectionView {
  mode: string;
  /** `<NIF>/<n>`, or null when no sub-user is stored. The password is never part of the view. */
  username: string | null;
  passwordSet: boolean;
  /** A password is stored but cannot be decrypted: the PII key changed since it was saved. */
  credentialsUnreadable: boolean;
  files: AtConfigStatus;
}

export async function getAtConnection(userId: string): Promise<AtConnectionView> {
  const connector = await findConnector(userId);
  const credentials = readCredentials(connector?.credentialsRef ?? null);
  return {
    mode: connector?.mode ?? DEFAULT_MODE,
    username: credentials.state === "set" ? credentials.login.username : null,
    passwordSet: credentials.state === "set",
    credentialsUnreadable: credentials.state === "unreadable",
    files: readAtConfig().status,
  };
}

export async function saveAtCredentials(userId: string, input: AtCredentialsInput): Promise<void> {
  const connector = await ensureConnector(userId, COUNTRY, PT_AT_CONNECTOR_KEY);

  let password = input.password;
  if (!password) {
    const current = readCredentials(connector.credentialsRef);
    if (current.state !== "set") {
      throw new ConflictError(
        "A password is required to store AT credentials",
        "at_password_required",
      );
    }
    password = current.login.password;
  }

  const stored = encryptPII(JSON.stringify({ username: input.username, password }));
  if (!isEncrypted(stored)) {
    throw new ConflictError(
      "PII_ENCRYPTION_KEY is not set: the AT password is never stored in clear",
      "at_credentials_need_key",
    );
  }

  await getPrismaClient().taxAuthorityConnector.update({
    where: { id: connector.id },
    data: { credentialsRef: stored },
  });
  await logAudit({
    userId,
    action: "SET_TAX_CREDENTIALS",
    resourceType: "TaxAuthorityConnector",
    resourceId: connector.id,
    details: { passwordChanged: Boolean(input.password) },
  });
}

export async function removeAtCredentials(userId: string): Promise<void> {
  const connector = await findConnector(userId);
  if (!connector?.credentialsRef) return;

  // A connector left in the test mode without a login could not make a call anyway; putting it
  // back to review keeps the mode honest about what the connector can do.
  const mode = TEST_MODES.has(connector.mode) ? DEFAULT_MODE : connector.mode;
  await getPrismaClient().taxAuthorityConnector.update({
    where: { id: connector.id },
    data: { credentialsRef: null, mode },
  });
  await logAudit({
    userId,
    action: "REMOVE_TAX_CREDENTIALS",
    resourceType: "TaxAuthorityConnector",
    resourceId: connector.id,
  });
}

export async function setAtMode(userId: string, mode: AtSelectableMode): Promise<void> {
  const connector = await ensureConnector(userId, COUNTRY, PT_AT_CONNECTOR_KEY);
  if (TEST_MODES.has(mode)) requireReady(connector.credentialsRef);
  if (connector.mode === mode) return;

  await getPrismaClient().taxAuthorityConnector.update({
    where: { id: connector.id },
    data: { mode },
  });
  await logAudit({
    userId,
    action: "SET_TAX_CONNECTOR_MODE",
    resourceType: "TaxAuthorityConnector",
    resourceId: connector.id,
    details: { from: connector.mode, to: mode },
  });
}

/** The files and the login a call needs, or the refusal that names what is missing. */
function requireReady(credentialsRef: string | null) {
  const { material } = readAtConfig();
  if (!material) {
    throw new ConflictError("The AT certificate files are not ready", "at_files_not_ready");
  }
  const credentials = readCredentials(credentialsRef);
  if (credentials.state === "unreadable") {
    throw new ConflictError(
      "The stored AT credentials cannot be decrypted",
      "at_credentials_unreadable",
    );
  }
  if (credentials.state === "unset") {
    throw new ConflictError("No AT credentials are stored", "at_credentials_missing");
  }
  return { material, login: credentials.login };
}

async function prepareCall(userId: string) {
  const connector = await findConnector(userId);
  if (!connector || !TEST_MODES.has(connector.mode)) {
    throw new ConflictError("The connector is not in the test mode", "at_test_mode_required");
  }
  const { material, login } = requireReady(connector.credentialsRef);
  return {
    connector,
    context: { endpoint: AT_ENDPOINTS.test, login, material },
  };
}

/** What the screen needs from a call: never the transport's English reason, which is a log. */
export type AtCallView =
  | {
      outcome: "answer";
      code: number;
      category: AtCodeCategory;
      /** AT's own message, in Portuguese. */
      message: string;
      errors: AtFieldError[];
    }
  | { outcome: "fault"; faultString: string }
  | { outcome: "not_sent" }
  | { outcome: "unknown" };

function toView(result: AtOutcome): AtCallView {
  switch (result.outcome) {
    case "answer":
      return {
        outcome: "answer",
        code: result.code,
        category: result.category,
        message: result.message,
        errors: result.errors,
      };
    case "fault":
      return { outcome: "fault", faultString: result.faultString };
    case "not_sent":
      return { outcome: "not_sent" };
    case "unknown":
      return { outcome: "unknown" };
  }
}

async function logCall(
  userId: string,
  connector: { id: string; mode: string },
  call: Pick<Parameters<typeof logSubmission>[0], "subjectType" | "subjectId" | "action">,
  result: AtOutcome,
  succeeded: boolean,
): Promise<void> {
  const responseCode =
    result.outcome === "answer"
      ? String(result.code)
      : result.outcome === "unknown"
        ? "no_answer"
        : result.outcome;
  const responseBody =
    result.outcome === "answer"
      ? result.message
      : result.outcome === "fault"
        ? result.faultString
        : result.reason;
  await logSubmission({
    userId,
    connectorId: connector.id,
    ...call,
    mode: connector.mode,
    status: succeeded ? "success" : "error",
    responseCode,
    responseBody,
  });
}

/**
 * Check credentials: asks AT for receipt 0 of contract 0, which cannot exist. AT authenticates
 * first, so −1 means every credential was accepted. Nothing is created at AT.
 */
export async function runAtCheck(userId: string): Promise<AtCallView> {
  const { connector, context } = await prepareCall(userId);
  const result = await checkCredentials(context);
  await logCall(
    userId,
    connector,
    { subjectType: "connector", subjectId: connector.id, action: "check" },
    result,
    result.outcome === "answer" && authenticated(result.code),
  );
  return toView(result);
}

/** Fetch receipt: one receipt AT issued, as its PDF. Stores nothing; the owner downloads it. */
export async function fetchAtReceipt(
  userId: string,
  contractNumber: number,
  receiptNumber: number,
): Promise<{ call: AtCallView; pdf?: Buffer }> {
  const { connector, context } = await prepareCall(userId);
  const result = await obterRecibo(context, contractNumber, receiptNumber);
  const pdf = result.outcome === "answer" && result.code === 0 ? result.pdf : undefined;
  await logCall(
    userId,
    connector,
    {
      subjectType: "at_receipt",
      subjectId: `${contractNumber}/${receiptNumber}`,
      action: "fetch",
    },
    result,
    Boolean(pdf),
  );
  if (pdf) {
    // The receipt names the tenant and their NIF: reading it is recorded, as a contract download is.
    await logAudit({
      userId,
      action: "FETCH_AT_RECEIPT",
      resourceType: "TaxAuthorityConnector",
      resourceId: connector.id,
      details: { contractNumber, receiptNumber },
    });
  }
  return { call: toView(result), ...(pdf ? { pdf } : {}) };
}
