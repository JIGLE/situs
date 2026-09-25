import type { IncomingMessage } from "node:http";
import { request } from "node:https";
import type { TLSSocket } from "node:tls";

/**
 * HTTPS with mutual TLS to AT's webservice, and the one distinction issuing depends on.
 *
 * AT's webservice can neither list receipts nor void one, so a request whose answer is lost
 * cannot be checked or undone by software: sending it again may issue a second receipt. Every
 * failure therefore says which side of the wire it happened on:
 *
 * - `not_sent`: the connection or the TLS handshake failed, so AT never read the request. Safe
 *   to send again.
 * - `no_answer`: the request went out and no complete answer came back. AT may or may not have
 *   acted on it; the caller treats the outcome as unknown.
 *
 * "Went out" is judged conservatively: the request is written as soon as the handshake completes,
 * so any failure after `secureConnect` is `no_answer`. That errs one way only. Under TLS 1.3 the
 * client finishes its half of the handshake before the server has checked the client's
 * certificate, so a refused certificate arrives after `secureConnect`, as a reset the client cannot
 * tell from a dropped request, and reads as `no_answer` although AT read nothing. Treating a sent
 * request as unsent would risk a second receipt; the reverse costs only a question. Issuing
 * therefore makes a read-only call first, which surfaces a refused certificate before anything
 * that creates a receipt is sent.
 */

/** Manual v1.6, §3: tests on port 709, production on 409. */
export const AT_ENDPOINTS = {
  test: "https://servicos.portaldasfinancas.gov.pt:709/ws/arrendamento",
  production: "https://servicos.portaldasfinancas.gov.pt:409/ws/arrendamento",
} as const;

export interface ClientTls {
  /** PEM: the certificate AT signed for this instance. */
  cert: string | Buffer;
  /** PEM: its private key. */
  key: string | Buffer;
  /** Extra trust anchors for the server. Only tests set it; AT's server has a public CA. */
  ca?: string | Buffer;
}

export interface PostOptions {
  tls: ClientTls;
  /** The whole exchange, from connecting to the last byte of the answer. */
  timeoutMs?: number;
  /** SOAP 1.1's SOAPAction header. The WSDL names it; until then it is empty. */
  soapAction?: string;
  /** For tests; defaults to `MAX_RESPONSE_BYTES`. */
  maxResponseBytes?: number;
}

export type TransportResult =
  | { outcome: "answered"; status: number; body: string }
  | { outcome: "not_sent"; reason: string }
  | { outcome: "no_answer"; reason: string };

export const DEFAULT_TIMEOUT_MS = 30_000;

/** AT's largest answer is one receipt PDF in Base64. An answer this size is not one. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

function describe(error: NodeJS.ErrnoException): string {
  return error.code ? `${error.code}: ${error.message}` : error.message;
}

export function postSoap(url: string, xml: string, options: PostOptions): Promise<TransportResult> {
  const target = new URL(url);
  // The request carries the owner's encrypted Portal password; it never goes out in clear.
  if (target.protocol !== "https:") {
    return Promise.reject(new Error("AT's webservice is only reached over https"));
  }
  const body = Buffer.from(xml, "utf8");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;

  return new Promise((resolve) => {
    let handshakeDone = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: TransportResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const failure = (reason: string): TransportResult =>
      handshakeDone ? { outcome: "no_answer", reason } : { outcome: "not_sent", reason };

    const req = request({
      protocol: "https:",
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      // A fresh connection per call: `secureConnect` always fires, and no socket is shared.
      agent: false,
      cert: options.tls.cert,
      key: options.tls.key,
      ...(options.tls.ca ? { ca: options.tls.ca } : {}),
      minVersion: "TLSv1.2",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "Content-Length": body.length,
        SOAPAction: `"${options.soapAction ?? ""}"`,
      },
    });

    timer = setTimeout(() => {
      finish(failure(`no answer within ${timeoutMs} ms`));
      req.destroy();
    }, timeoutMs);

    req.on("socket", (socket) => {
      (socket as TLSSocket).once("secureConnect", () => {
        handshakeDone = true;
      });
    });

    req.on("response", (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          finish({ outcome: "no_answer", reason: `answer larger than ${maxBytes} bytes` });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () =>
        finish({
          outcome: "answered",
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
      res.on("error", (error: NodeJS.ErrnoException) =>
        finish({ outcome: "no_answer", reason: describe(error) }),
      );
      res.on("close", () =>
        finish({ outcome: "no_answer", reason: "connection closed before the answer ended" }),
      );
    });

    req.on("error", (error: NodeJS.ErrnoException) => finish(failure(describe(error))));

    req.end(body);
  });
}
