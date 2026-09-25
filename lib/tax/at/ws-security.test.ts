import { describe, expect, it } from "vitest";
import {
  constants,
  createDecipheriv,
  createHash,
  generateKeyPairSync,
  privateDecrypt,
} from "node:crypto";
import {
  AT_USERNAME,
  buildUsernameToken,
  escapeXml,
  securityHeaderXml,
  type AtLogin,
} from "./ws-security";

/**
 * Each field is decrypted back with a test key pair standing in for AT's, so these assert what
 * AT will compute from the header rather than restating how it was built.
 */

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const login: AtLogin = { username: "555555555/1", password: "segredo<&>'\"ção" };
const NOW = new Date("2026-09-25T08:15:30.123Z");

/**
 * RSA PKCS#1 v1.5 decryption. Node 22 refuses `RSA_PKCS1_PADDING` for private decryption
 * (CVE-2023-46809), so this decrypts raw and strips the padding itself: 0x00 0x02, nonzero
 * random bytes, 0x00, then the message.
 */
function rsaDecrypt(base64: string): Buffer {
  const block = privateDecrypt(
    { key: privateKey, padding: constants.RSA_NO_PADDING },
    Buffer.from(base64, "base64"),
  );
  expect(block[0]).toBe(0x00);
  expect(block[1]).toBe(0x02);
  return block.subarray(block.indexOf(0x00, 2) + 1);
}

function aesDecrypt(key: Buffer, base64: string): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(Buffer.from(base64, "base64")), decipher.final()]);
}

describe("buildUsernameToken", () => {
  it("encrypts a 128-bit session key for AT's public key", () => {
    const token = buildUsernameToken(login, { publicKey, now: NOW });
    expect(rsaDecrypt(token.nonce)).toHaveLength(16);
  });

  it("encrypts the password with that key, so AT can read it back", () => {
    const token = buildUsernameToken(login, { publicKey, now: NOW });
    const key = rsaDecrypt(token.nonce);
    expect(aesDecrypt(key, token.password).toString("utf8")).toBe(login.password);
  });

  it("digests key, Created and password, in that order, and encrypts the digest", () => {
    const token = buildUsernameToken(login, { publicKey, now: NOW });
    const key = rsaDecrypt(token.nonce);
    const expected = createHash("sha1")
      .update(Buffer.concat([key, Buffer.from(token.created), Buffer.from(login.password)]))
      .digest();
    expect(aesDecrypt(key, token.digest)).toEqual(expected);
  });

  it("sends Created in clear by default, as UTC ISO 8601 with milliseconds", () => {
    const token = buildUsernameToken(login, { publicKey, now: NOW });
    expect(token.created).toBe("2026-09-25T08:15:30.123Z");
  });

  it("can encrypt Created instead, and still digests the clear timestamp", () => {
    const token = buildUsernameToken(login, { publicKey, now: NOW, encryptCreated: true });
    const key = rsaDecrypt(token.nonce);
    const created = aesDecrypt(key, token.created).toString("utf8");
    expect(created).toBe("2026-09-25T08:15:30.123Z");
    const expected = createHash("sha1")
      .update(Buffer.concat([key, Buffer.from(created), Buffer.from(login.password)]))
      .digest();
    expect(aesDecrypt(key, token.digest)).toEqual(expected);
  });

  it("never repeats a key: AT refuses a repeated one (code 12)", () => {
    const keys = new Set(
      Array.from({ length: 20 }, () =>
        rsaDecrypt(buildUsernameToken(login, { publicKey, now: NOW }).nonce).toString("hex"),
      ),
    );
    expect(keys.size).toBe(20);
  });

  it("takes AT's key as PEM text, as the mounted file reads", () => {
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const token = buildUsernameToken(login, { publicKey: pem, now: NOW });
    expect(aesDecrypt(rsaDecrypt(token.nonce), token.password).toString("utf8")).toBe(
      login.password,
    );
  });

  it("refuses a session key that is not 128 bits", () => {
    expect(() => buildUsernameToken(login, { publicKey, sessionKey: Buffer.alloc(24, 1) })).toThrow(
      /128 bits/,
    );
  });
});

describe("securityHeaderXml", () => {
  it("declares its namespaces and AT's version 2", () => {
    const xml = securityHeaderXml(buildUsernameToken(login, { publicKey, now: NOW }));
    expect(xml).toContain('xmlns:wss="http://schemas.xmlsoap.org/ws/2002/12/secext"');
    expect(xml).toContain('xmlns:at="http://at.pt/wsp/auth"');
    expect(xml).toContain('at:Version="2"');
    expect(xml).toMatch(
      /<wss:UsernameToken><wss:Username>555555555\/1<\/wss:Username><wss:Password Digest="[^"]+">[^<]+<\/wss:Password><wss:Nonce>[^<]+<\/wss:Nonce><wss:Created>2026-09-25T08:15:30.123Z<\/wss:Created><\/wss:UsernameToken>/,
    );
  });

  it("escapes what it writes", () => {
    expect(escapeXml(`a<b>&"c'`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
  });
});

describe("AT_USERNAME", () => {
  it("takes a NIF, a slash and a sub-user of one to four digits", () => {
    for (const ok of ["555555555/1", "555555555/0000", "555555555/1234"]) {
      expect(AT_USERNAME.test(ok)).toBe(true);
    }
    for (const bad of [
      "555555555",
      "55555555/1",
      "555555555/12345",
      "555555555/a",
      " 555555555/1",
    ]) {
      expect(AT_USERNAME.test(bad)).toBe(false);
    }
  });
});
