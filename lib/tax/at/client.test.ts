// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type AddressInfo } from "node:net";
import { answerXml, faultXml, startFakeAt, type FakeAtOptions } from "@/tests/helpers/fake-at";
import { makeTestPki, type TestPki } from "@/tests/helpers/test-pki";
import { checkCredentials, obterRecibo, type AtClientContext } from "./client";
import { readAtConfig, type AtMaterial } from "./config";

/**
 * The client against a stand-in for AT (`tests/helpers/fake-at.ts`) that authenticates each
 * request as the manual says AT does. The material is loaded through `readAtConfig`, as an
 * instance loads it, so these also prove the files, the header and the transport fit together.
 */

let pki: TestPki;
let material: AtMaterial;
const PASSWORD = "senha-do-subutilizador";

beforeAll(() => {
  pki = makeTestPki();
  const { material: loaded } = readAtConfig({
    AT_CLIENT_CERT_FILE: pki.file("client.crt"),
    AT_CLIENT_KEY_FILE: pki.file("client.key"),
    AT_AUTH_PUBLIC_KEY_FILE: pki.file("at-auth.crt"),
  });
  // The fake server's certificate comes from the test CA, which a real instance never trusts.
  material = { ...loaded!, tls: { ...loaded!.tls, ca: pki.read("ca.crt") } };
}, 60_000);

afterAll(() => pki?.cleanup());

async function withFakeAt(
  options: Partial<FakeAtOptions>,
  run: (context: AtClientContext, fake: Awaited<ReturnType<typeof startFakeAt>>) => Promise<void>,
) {
  const fake = await startFakeAt(pki, { password: PASSWORD, ...options });
  try {
    await run(
      { endpoint: fake.url, login: { username: "555555555/1", password: PASSWORD }, material },
      fake,
    );
  } finally {
    await fake.close();
  }
}

describe("checkCredentials", () => {
  it("authenticates, and reads AT's −1 for receipt 0 as credentials accepted", async () => {
    await withFakeAt({}, async (context, fake) => {
      const outcome = await checkCredentials(context);
      expect(outcome).toMatchObject({ outcome: "answer", code: -1, category: "rejected" });
      expect(fake.requests).toEqual([
        expect.objectContaining({
          operation: "obterReciboRequest",
          username: "555555555/1",
          password: PASSWORD,
          fields: { numeroContrato: "0", numeroRecibo: "0" },
        }),
      ]);
    });
  });

  it("names the credential AT refused", async () => {
    await withFakeAt({}, async (context) => {
      const outcome = await checkCredentials({
        ...context,
        login: { ...context.login, password: "wrong" },
      });
      expect(outcome).toMatchObject({ outcome: "answer", code: 99, category: "password" });
    });
  });

  it("uses a new session key for every call, which AT requires (code 12)", async () => {
    await withFakeAt({}, async (context) => {
      const first = await checkCredentials(context);
      const second = await checkCredentials(context);
      expect([first, second]).toMatchObject([{ code: -1 }, { code: -1 }]);
    });
  });

  it("sends Created encrypted when the switch is on", async () => {
    await withFakeAt({ createdEncrypted: true }, async (context) => {
      expect(await checkCredentials(context)).toMatchObject({ code: 16, category: "key" });
      expect(await checkCredentials({ ...context, encryptCreated: true })).toMatchObject({
        code: -1,
      });
    });
  });
});

describe("obterRecibo", () => {
  it("returns AT's receipt PDF", async () => {
    const pdf = Buffer.from("%PDF-1.4 recibo de renda");
    await withFakeAt(
      {
        answer: () => ({
          xml: answerXml("obterReciboResponse", {
            codigo: 0,
            mensagem: "OK",
            recibo: pdf.toString("base64"),
          }),
        }),
      },
      async (context, fake) => {
        const outcome = await obterRecibo(context, 123456, 7);
        expect(outcome).toMatchObject({ outcome: "answer", code: 0, category: "ok" });
        expect(outcome.outcome === "answer" && outcome.pdf).toEqual(pdf);
        expect(fake.requests[0].fields).toEqual({ numeroContrato: "123456", numeroRecibo: "7" });
      },
    );
  });

  it("returns a SOAP Fault as a fault", async () => {
    await withFakeAt(
      { answer: () => ({ status: 500, xml: faultXml("Pedido inválido") }) },
      async (context) => {
        expect(await obterRecibo(context, 1, 1)).toEqual({
          outcome: "fault",
          faultCode: "S:Client",
          faultString: "Pedido inválido",
        });
      },
    );
  });

  it("reads an answer it cannot parse as unknown, never as a result", async () => {
    await withFakeAt(
      { answer: () => ({ status: 502, xml: "<html>Bad Gateway</html>" }) },
      async (context) => {
        expect(await obterRecibo(context, 1, 1)).toMatchObject({
          outcome: "unknown",
          reason: expect.stringMatching(/^HTTP 502/),
        });
      },
    );
  });

  it("reports a call that never reached AT as not sent", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolve) => probe.close(resolve));

    const outcome = await obterRecibo(
      {
        endpoint: `https://127.0.0.1:${port}/ws`,
        login: { username: "555555555/1", password: PASSWORD },
        material,
      },
      1,
      1,
    );
    expect(outcome.outcome).toBe("not_sent");
  });
});
