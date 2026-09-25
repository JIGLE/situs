import { XMLParser, XMLValidator } from "fast-xml-parser";
import { escapeXml } from "./ws-security";

/**
 * SOAP 1.1 envelopes for AT's `arrendamento` webservice, and the reading of its answers.
 *
 * Element names and order are the manual's (§4.1, §4.2). The operations' own namespace is not in
 * the manual: it is in the WSDL, which comes with AT's test kit. Until then it lives in one
 * constant, and a wrong guess shows up as AT's code 33, "Pedido SOAP inválido", on the first
 * Check credentials. When the WSDL arrives it joins `tests/fixtures` and a test pins this.
 */

export const SOAP_ENV_NS = "http://schemas.xmlsoap.org/soap/envelope/";
/**
 * A GUESS, not a value from AT: the manual declares only the `at`, `S` and `wss` prefixes. The
 * WSDL in AT's test kit replaces it. Check credentials reports AT's code and message as they
 * come, so a wrong namespace is visible, not silent.
 */
export const ARRENDAMENTO_NS = "http://at.gov.pt/arrendamento/";

export function envelope(securityHeader: string, body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<S:Envelope xmlns:S="${SOAP_ENV_NS}">` +
    `<S:Header>${securityHeader}</S:Header>` +
    `<S:Body>${body}</S:Body>` +
    `</S:Envelope>`
  );
}

function element(name: string, value: string | number): string {
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** `obterRecibo`: a receipt's PDF by contract and receipt number (manual §4.1). */
export function obterReciboBody(numeroContrato: number, numeroRecibo: number): string {
  return (
    `<ns:obterReciboRequest xmlns:ns="${ARRENDAMENTO_NS}">` +
    element("numeroContrato", numeroContrato) +
    element("numeroRecibo", numeroRecibo) +
    `</ns:obterReciboRequest>`
  );
}

export interface AtFieldError {
  field?: string;
  message: string;
}

export type AtResponse =
  | {
      kind: "answer";
      /** The response element, without its prefix: `obterReciboResponse`. */
      operation: string;
      code: number;
      message: string;
      receiptNumber?: number;
      contractNumber?: number;
      /** `obterRecibo`'s PDF. */
      pdf?: Buffer;
      errors: AtFieldError[];
    }
  | { kind: "fault"; faultCode: string; faultString: string }
  /** Not XML, not SOAP, or SOAP without an answer this reader understands. */
  | { kind: "unreadable"; detail: string };

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  // Keep every value a string: a receipt number must not become a float, nor a PDF a number.
  parseTagValue: false,
  trimValues: true,
});

type Node = Record<string, unknown>;

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;

const integer = (value: unknown): number | undefined => {
  const raw = text(value);
  return raw !== undefined && /^-?\d+$/.test(raw.trim()) ? Number(raw) : undefined;
};

/** The object that holds `codigo`: the response element, or one wrapper inside it. */
function resultOf(response: Node): Node | undefined {
  if ("codigo" in response) return response;
  for (const child of Object.values(response)) {
    if (isNode(child) && "codigo" in child) return child;
  }
  return undefined;
}

/** `erros` holds one `erro` or a list of them, each with a message and perhaps a field. */
function fieldErrors(result: Node): AtFieldError[] {
  const errors = result.erros;
  if (!isNode(errors)) return [];
  const list = Array.isArray(errors.erro) ? errors.erro : errors.erro ? [errors.erro] : [];
  return list.flatMap((entry): AtFieldError[] => {
    if (!isNode(entry)) {
      const message = text(entry);
      return message ? [{ message }] : [];
    }
    const message = text(entry.mensagem) ?? "";
    const field = text(entry.campo);
    return [{ ...(field ? { field } : {}), message }];
  });
}

export function parseResponse(xml: string): AtResponse {
  if (!xml.trim()) return { kind: "unreadable", detail: "empty response" };
  const valid = XMLValidator.validate(xml);
  if (valid !== true) return { kind: "unreadable", detail: `not XML: ${valid.err.msg}` };

  const doc = parser.parse(xml) as Node;
  const body = isNode(doc.Envelope) ? doc.Envelope.Body : undefined;
  if (!isNode(body)) return { kind: "unreadable", detail: "no SOAP body" };

  if (isNode(body.Fault)) {
    return {
      kind: "fault",
      faultCode: text(body.Fault.faultcode) ?? "",
      faultString: text(body.Fault.faultstring) ?? "",
    };
  }

  const [operation, response] = Object.entries(body)[0] ?? [];
  const result = isNode(response) ? resultOf(response) : undefined;
  const code = result ? integer(result.codigo) : undefined;
  if (!operation || !result || code === undefined) {
    return { kind: "unreadable", detail: "no response code" };
  }

  const pdf = text(result.recibo);
  return {
    kind: "answer",
    operation,
    code,
    message: text(result.mensagem) ?? "",
    receiptNumber: integer(result.numeroRecibo),
    contractNumber: integer(result.numeroContrato),
    ...(pdf ? { pdf: Buffer.from(pdf.replace(/\s+/g, ""), "base64") } : {}),
    errors: fieldErrors(result),
  };
}
