import { constants, createDecipheriv, createHash, privateDecrypt } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { XMLParser } from "fast-xml-parser";
import type { TestPki } from "./test-pki";

/**
 * A stand-in for AT's `arrendamento` webservice, for the AT client's tests.
 *
 * It serves mutual TLS with the test PKI, refusing a client certificate its CA did not sign, and
 * authenticates each request the way the manual (§4.1) says AT does: it decrypts the Nonce with
 * the stand-in AT key to get the session key, decrypts the password with it, and checks the
 * Digest. A request that fails gets the manual's code for what failed; one that passes gets
 * `answer`. It is written from the manual, not from the client, so a test against it checks the
 * client rather than restating it.
 */

export interface FakeAtRequest {
  /** The request element, without its prefix: `obterReciboRequest`. */
  operation: string;
  username: string;
  password: string;
  created: string;
  fields: Record<string, unknown>;
  soapAction?: string;
}

export interface FakeAtAnswer {
  status?: number;
  xml: string;
}

export interface FakeAtOptions {
  /** The Portal password the stand-in accepts. */
  password: string;
  /** Whether it expects `Created` encrypted, the other reading of the manual. */
  createdEncrypted?: boolean;
  /** Answers an authenticated request; by default, −1 as for a receipt that does not exist. */
  answer?: (request: FakeAtRequest) => FakeAtAnswer;
}

export interface FakeAt {
  url: string;
  /** Every request that got past TLS, authenticated or not. */
  requests: FakeAtRequest[];
  close(): Promise<void>;
}

/** An answer in the shape the manual gives for every operation (§4.2). */
export function answerXml(operation: string, fields: Record<string, string | number>): string {
  const inner = Object.entries(fields)
    .map(([name, value]) => `<${name}>${value}</${name}>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>` +
    `<ns2:${operation} xmlns:ns2="http://at.gov.pt/fake">${inner}</ns2:${operation}>` +
    `</S:Body></S:Envelope>`
  );
}

export function faultXml(faultString: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><S:Fault>` +
    `<faultcode>S:Client</faultcode><faultstring>${faultString}</faultstring>` +
    `</S:Fault></S:Body></S:Envelope>`
  );
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
});

/** A parsed XML element's children, or none: the request is untrusted input. */
function node(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function unpad(block: Buffer): Buffer {
  // RSA PKCS#1 v1.5: 0x00 0x02, nonzero padding, 0x00, then the message.
  if (block[0] !== 0x00 || block[1] !== 0x02) throw new Error("bad padding");
  return block.subarray(block.indexOf(0x00, 2) + 1);
}

function aesDecrypt(key: Buffer, base64: string): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(Buffer.from(base64, "base64")), decipher.final()]);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export async function startFakeAt(pki: TestPki, options: FakeAtOptions): Promise<FakeAt> {
  const requests: FakeAtRequest[] = [];
  const usedKeys = new Set<string>();
  const authKey = pki.read("at-auth.key");

  const authenticate = (token: Record<string, unknown>): { code: number } | FakeAtRequest => {
    const username = String(token.Username ?? "");
    if (!username) return { code: 1 };
    if (!/^\d{9}\/\d{1,4}$/.test(username)) return { code: 4 };

    let key: Buffer;
    try {
      key = unpad(
        privateDecrypt(
          { key: authKey, padding: constants.RSA_NO_PADDING },
          Buffer.from(String(token.Nonce), "base64"),
        ),
      );
    } catch {
      return { code: 8 };
    }
    if (key.length !== 16) return { code: 11 };
    if (usedKeys.has(key.toString("hex"))) return { code: 12 };
    usedKeys.add(key.toString("hex"));

    const passwordNode = token.Password as Record<string, string>;
    let password: string;
    let created = String(token.Created ?? "");
    try {
      password = aesDecrypt(key, passwordNode["#text"]).toString("utf8");
    } catch {
      return { code: 17 };
    }
    if (options.createdEncrypted) {
      try {
        created = aesDecrypt(key, created).toString("utf8");
      } catch {
        return { code: 16 };
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(created)) return { code: 9 };

    let digest: Buffer;
    try {
      digest = aesDecrypt(key, passwordNode["@Digest"]);
    } catch {
      return { code: 18 };
    }
    const expected = createHash("sha1")
      .update(Buffer.concat([key, Buffer.from(created), Buffer.from(password)]))
      .digest();
    if (!digest.equals(expected)) return { code: 18 };
    if (password !== options.password) return { code: 99 };

    return { operation: "", username, password, created, fields: {} };
  };

  const server = createServer(
    {
      key: pki.read("server.key"),
      cert: pki.read("server.crt"),
      ca: pki.read("ca.crt"),
      requestCert: true,
      rejectUnauthorized: true,
    },
    async (req, res) => {
      const envelope = node(node(parser.parse(await readBody(req))).Envelope);
      const token = node(node(node(envelope.Header).Security).UsernameToken);
      const [operation, fields] = Object.entries(node(envelope.Body))[0] ?? ["", {}];
      const response = operation.replace(/Request$/, "Response");

      const result = authenticate(token);
      if ("code" in result) {
        requests.push({
          operation,
          username: String(token.Username ?? ""),
          password: "",
          created: "",
          fields: {},
        });
        res
          .writeHead(200, { "Content-Type": "text/xml" })
          .end(answerXml(response, { codigo: result.code, mensagem: "Erro de autenticação" }));
        return;
      }

      const request: FakeAtRequest = {
        ...result,
        operation,
        fields: fields as Record<string, unknown>,
        soapAction: req.headers.soapaction as string | undefined,
      };
      requests.push(request);
      const answer = options.answer?.(request) ?? {
        xml: answerXml(response, { codigo: -1, mensagem: "Não foi possível obter o recibo" }),
      };
      res.writeHead(answer.status ?? 200, { "Content-Type": "text/xml" }).end(answer.xml);
    },
  );

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}/ws/arrendamento`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
