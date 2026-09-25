import { categorize, type AtCodeCategory } from "./codes";
import type { AtMaterial } from "./config";
import { envelope, obterReciboBody, parseResponse, SOAP_ACTIONS, type AtFieldError } from "./soap";
import { postSoap } from "./transport";
import { buildUsernameToken, securityHeaderXml, type AtLogin } from "./ws-security";

/**
 * One call to AT's webservice: a fresh security header, the envelope, the mutual-TLS request, and
 * the answer read back. Every outcome is a value, never a throw, so the caller must decide what
 * each means for the owner.
 */

export interface AtClientContext {
  /** `AT_ENDPOINTS.test` or `.production`, chosen by the connector's mode. */
  endpoint: string;
  /** The Portal sub-user: `<NIF>/<n>` and its password. */
  login: AtLogin;
  material: AtMaterial;
  /** Which reading of the manual AT's test endpoint confirms; see ws-security.ts. */
  encryptCreated?: boolean;
  timeoutMs?: number;
}

export type AtOutcome =
  /** AT answered with a code: 0 success, −1 refused, or the authentication code that failed. */
  | {
      outcome: "answer";
      operation: string;
      code: number;
      category: AtCodeCategory;
      message: string;
      receiptNumber?: number;
      contractNumber?: number;
      pdf?: Buffer;
      errors: AtFieldError[];
    }
  /** AT's SOAP layer refused the request before any operation ran. */
  | { outcome: "fault"; faultCode: string; faultString: string }
  /** It never reached AT: safe to send again. */
  | { outcome: "not_sent"; reason: string }
  /** It reached AT and nothing readable came back: AT may or may not have acted on it. */
  | { outcome: "unknown"; reason: string };

async function call(
  context: AtClientContext,
  body: string,
  soapAction: string,
): Promise<AtOutcome> {
  const token = buildUsernameToken(context.login, {
    publicKey: context.material.authKey,
    encryptCreated: context.encryptCreated,
  });
  const sent = await postSoap(context.endpoint, envelope(securityHeaderXml(token), body), {
    tls: context.material.tls,
    timeoutMs: context.timeoutMs,
    soapAction,
  });
  if (sent.outcome === "not_sent") return sent;
  if (sent.outcome === "no_answer") return { outcome: "unknown", reason: sent.reason };

  const read = parseResponse(sent.body);
  if (read.kind === "fault") {
    return { outcome: "fault", faultCode: read.faultCode, faultString: read.faultString };
  }
  if (read.kind === "unreadable") {
    return { outcome: "unknown", reason: `HTTP ${sent.status}: ${read.detail}` };
  }
  const { kind: _kind, ...answer } = read;
  return { outcome: "answer", ...answer, category: categorize(read.code) };
}

/** A receipt AT issued, as its PDF (manual §4.1, `obterRecibo`). Read-only. */
export function obterRecibo(
  context: AtClientContext,
  numeroContrato: number,
  numeroRecibo: number,
): Promise<AtOutcome> {
  return call(context, obterReciboBody(numeroContrato, numeroRecibo), SOAP_ACTIONS.obterRecibo);
}

/**
 * Proves the certificate, the files and the login without creating anything: it asks for receipt
 * 0 of contract 0, which cannot exist. AT authenticates before it looks, so −1 ("could not get
 * the receipt") means every credential was accepted, and an authentication code names the one
 * that was not.
 */
export function checkCredentials(context: AtClientContext): Promise<AtOutcome> {
  return obterRecibo(context, 0, 0);
}
