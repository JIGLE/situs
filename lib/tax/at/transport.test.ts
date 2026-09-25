// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:https";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import type { TLSSocket } from "node:tls";
import { makeTestPki, type TestPki } from "@/tests/helpers/test-pki";
import { postSoap, type ClientTls } from "./transport";

/**
 * A local HTTPS server that, like AT's, refuses a client whose certificate its CA did not sign.
 * The certificates are throwaway ones made for the suite (`tests/helpers/test-pki.ts`).
 */

let pki: TestPki;
let owner: ClientTls;
let stranger: ClientTls;
let serverTls: { key: Buffer; cert: Buffer; ca: Buffer };

beforeAll(() => {
  pki = makeTestPki();
  serverTls = { key: pki.read("server.key"), cert: pki.read("server.crt"), ca: pki.read("ca.crt") };
  owner = { cert: pki.read("client.crt"), key: pki.read("client.key"), ca: pki.read("ca.crt") };
  stranger = {
    cert: pki.read("stranger.crt"),
    key: pki.read("stranger.key"),
    ca: pki.read("ca.crt"),
  };
}, 60_000);

afterAll(() => pki?.cleanup());

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Runs `run` against a mutual-TLS server; counts the requests its handler actually read. */
async function withServer(
  handler: Handler,
  run: (url: string, served: () => number) => Promise<void>,
  maxVersion: "TLSv1.2" | "TLSv1.3" = "TLSv1.3",
): Promise<void> {
  let count = 0;
  const server: Server = createServer(
    { ...serverTls, requestCert: true, rejectUnauthorized: true, maxVersion },
    (req, res) => {
      count += 1;
      handler(req, res);
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`https://127.0.0.1:${port}/ws/arrendamento`, () => count);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const SOAP = `<?xml version="1.0" encoding="UTF-8"?><S:Envelope xmlns:S="x"><S:Body>Ação</S:Body></S:Envelope>`;

describe("postSoap over mutual TLS", () => {
  it("presents the client certificate and returns AT's answer", async () => {
    let seen: Record<string, unknown> = {};
    await withServer(
      async (req, res) => {
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        seen = {
          subject: peer.subject?.CN,
          body: await readBody(req),
          type: req.headers["content-type"],
          action: req.headers.soapaction,
        };
        res.writeHead(200, { "Content-Type": "text/xml" }).end("<answer/>");
      },
      async (url) => {
        const result = await postSoap(url, SOAP, { tls: owner, soapAction: "obterRecibo" });
        expect(result).toEqual({ outcome: "answered", status: 200, body: "<answer/>" });
      },
    );
    expect(seen).toEqual({
      subject: "555555555",
      body: SOAP,
      type: "text/xml; charset=utf-8",
      action: '"obterRecibo"',
    });
  });

  it("returns an HTTP error status as an answer, for the SOAP reader to judge", async () => {
    await withServer(
      (_req, res) => res.writeHead(500).end("<S:Fault/>"),
      async (url) => {
        expect(await postSoap(url, SOAP, { tls: owner })).toEqual({
          outcome: "answered",
          status: 500,
          body: "<S:Fault/>",
        });
      },
    );
  });

  it("refuses to send anything but https", async () => {
    await expect(postSoap("http://127.0.0.1:1/ws", SOAP, { tls: owner })).rejects.toThrow(/https/);
  });
});

describe("postSoap: never sent, so safe to send again", () => {
  it("when AT refuses a certificate its CA did not sign, under TLS 1.2", async () => {
    await withServer(
      (_req, res) => res.end("<answer/>"),
      async (url, served) => {
        const result = await postSoap(url, SOAP, { tls: stranger, timeoutMs: 5_000 });
        expect(result.outcome).toBe("not_sent");
        expect(served()).toBe(0);
      },
      "TLSv1.2",
    );
  });

  it("when the server's certificate cannot be verified", async () => {
    await withServer(
      (_req, res) => res.end("<answer/>"),
      async (url, served) => {
        const { ca: _trusted, ...untrusting } = owner;
        const result = await postSoap(url, SOAP, { tls: untrusting, timeoutMs: 5_000 });
        expect(result.outcome).toBe("not_sent");
        expect(served()).toBe(0);
      },
    );
  });

  it("when nothing listens", async () => {
    const probe = createTcpServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolve) => probe.close(resolve));

    const result = await postSoap(`https://127.0.0.1:${port}/ws`, SOAP, { tls: owner });
    expect(result).toMatchObject({ outcome: "not_sent", reason: expect.stringMatching(/REFUSED/) });
  });

  it("when the handshake never completes before the timeout", async () => {
    // Reads the TLS ClientHello and never answers it.
    const silent = createTcpServer((socket) => socket.resume());
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as AddressInfo;
    try {
      const result = await postSoap(`https://127.0.0.1:${port}/ws`, SOAP, {
        tls: owner,
        timeoutMs: 300,
      });
      expect(result).toMatchObject({ outcome: "not_sent", reason: expect.stringMatching(/300/) });
    } finally {
      await new Promise((resolve) => silent.close(resolve));
    }
  });
});

describe("postSoap: sent without an answer, so the outcome is unknown", () => {
  it("errs on unknown for a certificate refused under TLS 1.3, which looks like a dropped request", async () => {
    await withServer(
      (_req, res) => res.end("<answer/>"),
      async (url, served) => {
        const result = await postSoap(url, SOAP, { tls: stranger, timeoutMs: 5_000 });
        expect(result.outcome).toBe("no_answer");
        expect(served()).toBe(0);
      },
    );
  });

  it("when AT reads the request and never answers", async () => {
    await withServer(
      () => {},
      async (url, served) => {
        const result = await postSoap(url, SOAP, { tls: owner, timeoutMs: 300 });
        expect(result).toMatchObject({
          outcome: "no_answer",
          reason: expect.stringMatching(/300/),
        });
        expect(served()).toBe(1);
      },
    );
  });

  it("when the connection drops after the request", async () => {
    await withServer(
      (req) => req.socket.destroy(),
      async (url, served) => {
        const result = await postSoap(url, SOAP, { tls: owner, timeoutMs: 5_000 });
        expect(result.outcome).toBe("no_answer");
        expect(served()).toBe(1);
      },
    );
  });

  it("when the answer is cut off", async () => {
    await withServer(
      (_req, res) => {
        res.writeHead(200, { "Content-Length": "100" });
        res.write("<partial");
        setTimeout(() => res.socket?.destroy(), 20);
      },
      async (url) => {
        const result = await postSoap(url, SOAP, { tls: owner, timeoutMs: 5_000 });
        expect(result.outcome).toBe("no_answer");
      },
    );
  });

  it("when the answer is larger than any AT sends", async () => {
    await withServer(
      (_req, res) => res.writeHead(200).end("x".repeat(4096)),
      async (url) => {
        const result = await postSoap(url, SOAP, { tls: owner, maxResponseBytes: 1024 });
        expect(result).toMatchObject({
          outcome: "no_answer",
          reason: expect.stringMatching(/1024/),
        });
      },
    );
  });
});
