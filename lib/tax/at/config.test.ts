// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { writeFileSync } from "node:fs";
import { makeTestPki, type TestPki } from "@/tests/helpers/test-pki";
import { readAtConfig } from "./config";
import { buildUsernameToken } from "./ws-security";

let pki: TestPki;

beforeAll(() => {
  pki = makeTestPki();
  writeFileSync(pki.file("garbage.pem"), "not a certificate\n");
  const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(pki.file("ec.pub"), ec.publicKey.export({ type: "spki", format: "pem" }));
}, 60_000);

afterAll(() => pki?.cleanup());

const env = (files: { cert?: string; key?: string; authKey?: string }) => ({
  ...(files.cert ? { AT_CLIENT_CERT_FILE: pki.file(files.cert) } : {}),
  ...(files.key ? { AT_CLIENT_KEY_FILE: pki.file(files.key) } : {}),
  ...(files.authKey ? { AT_AUTH_PUBLIC_KEY_FILE: pki.file(files.authKey) } : {}),
});

const complete = { cert: "client.crt", key: "client.key", authKey: "at-auth.crt" };

describe("readAtConfig", () => {
  it("is ready with the certificate, its key and AT's key, and says when the certificate ends", () => {
    const { status, material } = readAtConfig(env(complete));
    expect(status.ready).toBe(true);
    expect(status.files).toEqual({
      cert: { state: "ok", path: pki.file("client.crt") },
      key: { state: "ok", path: pki.file("client.key") },
      authKey: { state: "ok", path: pki.file("at-auth.crt") },
    });
    expect(status.keyMatches).toBe(true);
    expect(status.certificate).toMatchObject({ subject: "555555555" });
    expect(status.certificate!.daysLeft).toBeGreaterThanOrEqual(1);
    expect(status.authKeyValidTo).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(material!.tls.cert)).toContain("-----BEGIN CERTIFICATE-----");
    expect(String(material!.tls.key)).toMatch(/BEGIN PRIVATE KEY/);
  });

  it("loads the key AT's certificate carries, so AT can open what Situs encrypts with it", () => {
    const { material } = readAtConfig(env(complete));
    const token = buildUsernameToken(
      { username: "555555555/1", password: "x" },
      { publicKey: material!.authKey },
    );
    // PKCS#1 v1.5, unpadded by hand: Node 22 refuses that padding for private decryption.
    const block = privateDecrypt(
      { key: pki.read("at-auth.key"), padding: constants.RSA_NO_PADDING },
      Buffer.from(token.nonce, "base64"),
    );
    expect(block.subarray(block.indexOf(0x00, 2) + 1)).toHaveLength(16);
  });

  it("never puts a file's contents in the status", () => {
    const { status } = readAtConfig(env(complete));
    expect(JSON.stringify(status)).not.toMatch(/BEGIN|PRIVATE/);
  });

  it("takes a DER certificate, and AT's key as DER or as a bare public key", () => {
    for (const files of [
      { ...complete, cert: "client.der" },
      { ...complete, authKey: "at-auth.der" },
      { ...complete, authKey: "at-auth.pub" },
    ]) {
      expect(readAtConfig(env(files)).status.ready).toBe(true);
    }
    expect(readAtConfig(env({ ...complete, authKey: "at-auth.pub" })).status.authKeyValidTo).toBe(
      undefined,
    );
  });

  it("names each missing file", () => {
    const { status, material } = readAtConfig({});
    expect(status).toEqual({
      files: { cert: { state: "unset" }, key: { state: "unset" }, authKey: { state: "unset" } },
      ready: false,
    });
    expect(material).toBeUndefined();
  });

  it("tells an unreadable path from a file that is not a certificate or key", () => {
    const { status } = readAtConfig(
      env({ cert: "does-not-exist.crt", key: "garbage.pem", authKey: "garbage.pem" }),
    );
    expect(status.files.cert).toEqual({
      state: "unreadable",
      path: pki.file("does-not-exist.crt"),
    });
    expect(status.files.key.state).toBe("invalid");
    expect(status.files.authKey.state).toBe("invalid");
    expect(status.ready).toBe(false);
  });

  it("says a key is under a passphrase", () => {
    const { status } = readAtConfig(env({ ...complete, key: "client-encrypted.key" }));
    expect(status.files.key.state).toBe("encrypted");
    expect(status.ready).toBe(false);
  });

  it("refuses AT's key when it is not RSA", () => {
    expect(readAtConfig(env({ ...complete, authKey: "ec.pub" })).status.files.authKey.state).toBe(
      "invalid",
    );
  });

  it("is not ready when the key is not the certificate's", () => {
    const { status, material } = readAtConfig(env({ ...complete, key: "stranger.key" }));
    expect(status.keyMatches).toBe(false);
    expect(status.ready).toBe(false);
    expect(material).toBeUndefined();
  });

  it("is not ready outside the certificate's dates", () => {
    const { status } = readAtConfig(env(complete));
    const validTo = new Date(status.certificate!.validTo);
    const validFrom = new Date(status.certificate!.validFrom);

    const expired = readAtConfig(env(complete), new Date(validTo.getTime() + 1000));
    expect(expired.status.ready).toBe(false);
    expect(expired.status.certificate!.daysLeft).toBeLessThan(0);

    const early = readAtConfig(env(complete), new Date(validFrom.getTime() - 1000));
    expect(early.status.ready).toBe(false);
  });
});
