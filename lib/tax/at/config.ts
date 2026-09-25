import { X509Certificate, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ClientTls } from "./transport";

/**
 * The three files an instance needs to reach AT, each named by a path in the environment. They
 * are mounted like the Enable Banking key and never inlined: a PEM is longer than TrueNAS' config
 * fields allow.
 *
 * - `AT_CLIENT_CERT_FILE`: the SSL certificate AT signed for this instance, PEM or DER. It lasts
 *   12 months (manual §5).
 * - `AT_CLIENT_KEY_FILE`: its private key, PEM, without a passphrase.
 * - `AT_AUTH_PUBLIC_KEY_FILE`: AT's authentication public key, which encrypts every request's
 *   session key. A certificate or a bare public key, PEM or DER.
 *
 * Reading never throws: each file reports its own state, so Settings and the status page can say
 * which one is wrong. The status holds paths and dates, never a file's contents. Nothing is
 * cached, so a renewed certificate counts as soon as it is mounted.
 */

export const AT_FILE_ENV = {
  cert: "AT_CLIENT_CERT_FILE",
  key: "AT_CLIENT_KEY_FILE",
  authKey: "AT_AUTH_PUBLIC_KEY_FILE",
} as const;

export type AtFileName = keyof typeof AT_FILE_ENV;

/** `encrypted`: a private key under a passphrase, which Situs cannot unlock. */
export type AtFileState = "ok" | "unset" | "unreadable" | "invalid" | "encrypted";

/** Settings and the status page start warning this many days before the certificate expires. */
export const RENEWAL_WARNING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AtConfigStatus {
  files: Record<AtFileName, { state: AtFileState; path?: string }>;
  /** The client certificate, once it reads. Dates are ISO strings. */
  certificate?: { subject: string; validFrom: string; validTo: string; daysLeft: number };
  /** Whether the key file holds the certificate's private key; absent until both read. */
  keyMatches?: boolean;
  /** The expiry of AT's authentication key, when it came as a certificate. */
  authKeyValidTo?: string;
  /** Every file reads, the key is the certificate's, and the certificate is in date today. */
  ready: boolean;
}

/** What a request is made with. Server-side only: it holds the private key. */
export interface AtMaterial {
  tls: ClientTls;
  authKey: KeyObject;
}

/** A key under a passphrase: Situs cannot unlock it, and must say so rather than "invalid". */
class EncryptedKeyError extends Error {}

function parsePrivateKey(bytes: Buffer): KeyObject {
  // Recognised by its PEM header: the error OpenSSL raises for it varies between versions.
  const text = bytes.toString("utf8");
  if (text.includes("ENCRYPTED PRIVATE KEY") || text.includes("Proc-Type: 4,ENCRYPTED")) {
    throw new EncryptedKeyError();
  }
  return createPrivateKey(bytes);
}

interface Loaded<T> {
  state: AtFileState;
  path?: string;
  value?: T;
}

type Env = Readonly<Record<string, string | undefined>>;

function load<T>(env: Env, name: AtFileName, parse: (bytes: Buffer) => T): Loaded<T> {
  const path = env[AT_FILE_ENV[name]]?.trim();
  if (!path) return { state: "unset" };
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return { state: "unreadable", path };
  }
  try {
    return { state: "ok", path, value: parse(bytes) };
  } catch (error) {
    return { state: error instanceof EncryptedKeyError ? "encrypted" : "invalid", path };
  }
}

function parseAuthKey(bytes: Buffer): { key: KeyObject; validTo?: Date } {
  let result: { key: KeyObject; validTo?: Date };
  try {
    const certificate = new X509Certificate(bytes);
    result = { key: certificate.publicKey, validTo: certificate.validToDate };
  } catch {
    const pem = bytes.toString("utf8").includes("-----BEGIN");
    result = {
      key: pem
        ? createPublicKey(bytes)
        : createPublicKey({ key: bytes, format: "der", type: "spki" }),
    };
  }
  // The manual's Nonce is RSA-encrypted; any other key cannot produce one.
  if (result.key.asymmetricKeyType !== "rsa") throw new Error("not an RSA key");
  return result;
}

function commonName(subject: string): string {
  return /^CN=(.+)$/m.exec(subject)?.[1] ?? subject;
}

export function readAtConfig(
  env: Env = process.env,
  now: Date = new Date(),
): { status: AtConfigStatus; material?: AtMaterial } {
  const cert = load(env, "cert", (bytes) => new X509Certificate(bytes));
  const key = load(env, "key", parsePrivateKey);
  const authKey = load(env, "authKey", parseAuthKey);

  const state = <T>({ state, path }: Loaded<T>) => ({ state, ...(path ? { path } : {}) });
  const status: AtConfigStatus = {
    files: { cert: state(cert), key: state(key), authKey: state(authKey) },
    ready: false,
  };

  if (cert.value) {
    status.certificate = {
      subject: commonName(cert.value.subject),
      validFrom: cert.value.validFromDate.toISOString(),
      validTo: cert.value.validToDate.toISOString(),
      daysLeft: Math.floor((cert.value.validToDate.getTime() - now.getTime()) / DAY_MS),
    };
  }
  if (cert.value && key.value) status.keyMatches = cert.value.checkPrivateKey(key.value);
  if (authKey.value?.validTo) status.authKeyValidTo = authKey.value.validTo.toISOString();

  const inDate = !!cert.value && cert.value.validFromDate <= now && now < cert.value.validToDate;
  if (!cert.value || !key.value || !authKey.value || !status.keyMatches || !inDate) {
    return { status };
  }

  status.ready = true;
  return {
    status,
    material: {
      // TLS takes PEM text; a DER certificate is converted here.
      tls: { cert: cert.value.toString(), key: key.value.export({ type: "pkcs8", format: "pem" }) },
      authKey: authKey.value.key,
    },
  };
}
