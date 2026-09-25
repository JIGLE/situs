// @vitest-environment node
import { describe, expect, it } from "vitest";
import { XMLValidator } from "fast-xml-parser";
import { envelope, obterReciboBody, parseResponse } from "./soap";
import { authenticated, categorize } from "./codes";

const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>${body}</S:Body></S:Envelope>`;

describe("envelope and obterReciboBody", () => {
  it("builds well-formed SOAP with the header and body in their places", () => {
    const xml = envelope("<wss:Security/>", obterReciboBody(0, 0));
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain("<S:Header><wss:Security/></S:Header>");
    // The manual's field order: the contract, then the receipt.
    expect(xml).toMatch(/<numeroContrato>0<\/numeroContrato><numeroRecibo>0<\/numeroRecibo>/);
  });
});

describe("parseResponse", () => {
  it("reads a success, with the receipt's PDF", () => {
    const pdf = Buffer.from("%PDF-1.4 recibo");
    const res = parseResponse(
      wrap(
        `<ns2:obterReciboResponse xmlns:ns2="urn:x"><codigo>0</codigo>` +
          `<mensagem>Documento registado com sucesso</mensagem>` +
          `<recibo>${pdf.toString("base64")}</recibo></ns2:obterReciboResponse>`,
      ),
    );
    expect(res).toMatchObject({ kind: "answer", operation: "obterReciboResponse", code: 0 });
    expect(res.kind === "answer" && res.pdf?.equals(pdf)).toBe(true);
  });

  it("reads a refusal with AT's field errors, one or many", () => {
    const one = parseResponse(
      wrap(
        `<emitirReciboResponse><codigo>-1</codigo><mensagem>Erros</mensagem>` +
          `<erros><erro><campo>valor</campo><mensagem>Valor inválido</mensagem></erro></erros>` +
          `</emitirReciboResponse>`,
      ),
    );
    expect(one).toMatchObject({
      code: -1,
      errors: [{ field: "valor", message: "Valor inválido" }],
    });

    const many = parseResponse(
      wrap(
        `<emitirReciboResponse><codigo>-1</codigo><mensagem>Erros</mensagem><erros>` +
          `<erro><mensagem>Primeiro</mensagem></erro><erro><mensagem>Segundo</mensagem></erro>` +
          `</erros></emitirReciboResponse>`,
      ),
    );
    expect(many.kind === "answer" && many.errors.map((e) => e.message)).toEqual([
      "Primeiro",
      "Segundo",
    ]);
  });

  it("reads a result wrapped one level down, and keeps numbers exact", () => {
    const res = parseResponse(
      wrap(
        `<emitirReciboResponse><return><codigo>0</codigo><mensagem>OK</mensagem>` +
          `<numeroRecibo>000123456789</numeroRecibo></return></emitirReciboResponse>`,
      ),
    );
    expect(res).toMatchObject({ kind: "answer", code: 0, receiptNumber: 123456789 });
  });

  it("reads each authentication code", () => {
    for (const code of [1, 6, 9, 12, 16, 33, 99]) {
      const res = parseResponse(
        wrap(
          `<obterReciboResponse><codigo>${code}</codigo><mensagem>x</mensagem></obterReciboResponse>`,
        ),
      );
      expect(res).toMatchObject({ kind: "answer", code });
    }
  });

  it("reads a SOAP Fault", () => {
    const res = parseResponse(
      wrap(
        `<S:Fault><faultcode>S:Client</faultcode><faultstring>Bad request</faultstring></S:Fault>`,
      ),
    );
    expect(res).toEqual({ kind: "fault", faultCode: "S:Client", faultString: "Bad request" });
  });

  it("calls anything else unreadable rather than guessing", () => {
    expect(parseResponse("").kind).toBe("unreadable");
    expect(parseResponse("<html><body>502 Bad Gateway</body>").kind).toBe("unreadable");
    expect(parseResponse("<html><body>Gateway</body></html>").kind).toBe("unreadable");
    expect(
      parseResponse(wrap(`<obterReciboResponse><mensagem>x</mensagem></obterReciboResponse>`)).kind,
    ).toBe("unreadable");
  });
});

describe("codes", () => {
  it("groups AT's codes by what the owner can do about them", () => {
    expect(categorize(0)).toBe("ok");
    expect(categorize(-1)).toBe("rejected");
    expect(categorize(3)).toBe("username");
    expect(categorize(99)).toBe("password");
    expect(categorize(8)).toBe("key");
    expect(categorize(16)).toBe("key");
    expect(categorize(9)).toBe("clock");
    expect(categorize(33)).toBe("request");
    expect(categorize(-99)).toBe("at_fault");
    expect(categorize(42)).toBe("unknown");
  });

  it("counts only 0 and −1 as proof that the credentials were accepted", () => {
    expect(authenticated(0)).toBe(true);
    expect(authenticated(-1)).toBe(true);
    for (const code of [1, 6, 8, 9, 33, 99, -99, 42]) expect(authenticated(code)).toBe(false);
  });
});
