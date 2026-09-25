import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Throwaway certificates for the AT client's tests. openssl makes them in a temporary directory
 * when a suite starts, and `cleanup()` deletes it, so no key is ever committed.
 *
 * - `ca` signs the server's certificate and the owner's client certificate, as AT's CA does. The
 *   client certificate lasts 400 days, the rest two.
 * - `other-ca` signs a stranger's client certificate, which the server must refuse.
 * - `at-auth` stands in for AT's authentication key: a certificate (`.crt`, and `.der`), the
 *   form AT sends it in, and a bare public key (`.pub`).
 * - `client.der` is the owner's certificate in DER, and `client-encrypted.key` its key under a
 *   passphrase, both forms an owner may mount by mistake.
 */

export interface TestPki {
  dir: string;
  /** The absolute path of a file in the directory. */
  file(name: string): string;
  read(name: string): Buffer;
  cleanup(): void;
}

export function makeTestPki(): TestPki {
  const dir = mkdtempSync(path.join(tmpdir(), "situs-at-pki-"));
  const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });

  const selfSigned = (name: string, subject: string) =>
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-subj",
      subject,
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.crt`,
    );

  const issue = (name: string, subject: string, ca: string, extfile?: string, days = 2) => {
    openssl(
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-subj",
      subject,
      "-keyout",
      `${name}.key`,
      "-out",
      `${name}.csr`,
    );
    openssl(
      "x509",
      "-req",
      "-days",
      String(days),
      "-in",
      `${name}.csr`,
      "-CA",
      `${ca}.crt`,
      "-CAkey",
      `${ca}.key`,
      "-CAcreateserial",
      "-out",
      `${name}.crt`,
      ...(extfile ? ["-extfile", extfile] : []),
    );
  };

  selfSigned("ca", "/CN=Situs test CA");
  selfSigned("other-ca", "/CN=Another CA");
  writeFileSync(path.join(dir, "server.ext"), "subjectAltName=IP:127.0.0.1\n");
  issue("server", "/CN=127.0.0.1", "ca", "server.ext");
  // A year, like the certificate AT signs, so a status check can see it valid, then ending.
  issue("client", "/CN=555555555", "ca", undefined, 400);
  issue("stranger", "/CN=999999990", "other-ca");
  openssl("x509", "-in", "client.crt", "-outform", "DER", "-out", "client.der");
  openssl(
    "pkey",
    "-in",
    "client.key",
    "-aes256",
    "-passout",
    "pass:secret",
    "-out",
    "client-encrypted.key",
  );
  selfSigned("at-auth", "/CN=AT authentication test key");
  openssl("x509", "-in", "at-auth.crt", "-outform", "DER", "-out", "at-auth.der");
  openssl("pkey", "-in", "at-auth.key", "-pubout", "-out", "at-auth.pub");

  return {
    dir,
    file: (name) => path.join(dir, name),
    read: (name) => readFileSync(path.join(dir, name)),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
