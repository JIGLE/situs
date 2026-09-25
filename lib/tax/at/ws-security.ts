import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";

/**
 * The WS-Security header AT's webservices authenticate every call with.
 *
 * Pure: node:crypto only, no IO. From the *Manual de Integração de Software*, "Comunicação de
 * contratos de arrendamento e emissão de recibos de renda à AT" (v1.6, August 2024), §4.1:
 *
 * - `Username` is `<NIF>/<sub-user>`, the Portal das Finanças login of the user filing.
 * - `Nonce` is a fresh 128-bit AES key, never repeated, encrypted with AT's authentication
 *   public key (RSA) and Base64-encoded.
 * - `Password` is the Portal password, AES-ECB/PKCS5-encrypted with that key, in Base64.
 * - Its `Digest` attribute is Base64(AES-ECB/PKCS5(key, SHA-1(key ‖ Created ‖ password))).
 * - `Created` is the UTC time in ISO 8601, as `2015-03-09T20:45:05.424Z`.
 * - `wss:Security` carries `at:Version="2"`.
 *
 * The one contradiction: §4.1 says `Created` "não deve ser cifrado", and that the Nonce's key
 * exists to encrypt Password *and* Created; error 16 reads "não foi possível decifrar o campo
 * Created". `encryptCreated` switches between the two readings, off by default because the
 * manual's own example sends it in clear. AT's test endpoint decides; the Digest always hashes
 * the clear timestamp either way.
 */

export const WSS_NS = "http://schemas.xmlsoap.org/ws/2002/12/secext";
export const AT_AUTH_NS = "http://at.pt/wsp/auth";

export interface AtLogin {
  /** `<NIF>/<sub-user>`, e.g. `555555555/1`. */
  username: string;
  password: string;
}

export interface UsernameToken {
  username: string;
  /** Base64 of the AES-encrypted password. */
  password: string;
  /** Base64 of the AES-encrypted SHA-1 digest. */
  digest: string;
  /** Base64 of the RSA-encrypted AES key. */
  nonce: string;
  /** The timestamp, in clear or Base64-encrypted according to `encryptCreated`. */
  created: string;
}

export interface TokenOptions {
  /** AT's authentication public key, as PEM or a KeyObject. */
  publicKey: string | KeyObject;
  /** Defaults to now. */
  now?: Date;
  /** See the note on the contradiction above. */
  encryptCreated?: boolean;
  /** For tests only: the AES key a real call draws at random. */
  sessionKey?: Buffer;
}

function aesEcb(key: Buffer, data: Buffer): Buffer {
  // PKCS#5 and PKCS#7 padding coincide for AES's 16-byte block, and Node pads with it by default.
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** A UTC ISO-8601 timestamp with milliseconds, the form the manual's example uses. */
export function createdTimestamp(now: Date): string {
  return now.toISOString();
}

export function buildUsernameToken(login: AtLogin, options: TokenOptions): UsernameToken {
  const key = options.sessionKey ?? randomBytes(16);
  if (key.length !== 16) throw new Error("The session key must be 128 bits");

  const publicKey =
    typeof options.publicKey === "string" ? createPublicKey(options.publicKey) : options.publicKey;
  const created = createdTimestamp(options.now ?? new Date());
  const password = Buffer.from(login.password, "utf8");
  // SHA-1 over the password is AT's protocol (manual §4.1), not a choice: no other digest
  // authenticates. Nor is it a stored password hash; it travels once, AES-encrypted under this
  // request's key, to AT over mutual TLS. CodeQL reports it as a weak password hash. Dismiss that
  // alert in the Security tab: an inline codeql[...] comment does nothing in this repository,
  // whose security-and-quality suite does not run CodeQL's suppression query.
  const digest = createHash("sha1")
    .update(Buffer.concat([key, Buffer.from(created, "utf8"), password]))
    .digest();

  return {
    username: login.username,
    password: aesEcb(key, password).toString("base64"),
    digest: aesEcb(key, digest).toString("base64"),
    nonce: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, key).toString(
      "base64",
    ),
    created: options.encryptCreated
      ? aesEcb(key, Buffer.from(created, "utf8")).toString("base64")
      : created,
  };
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapes text for an XML element or a double-quoted attribute. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

/** The `wss:Security` element, namespaces declared on it, for a SOAP header. */
export function securityHeaderXml(token: UsernameToken): string {
  return (
    `<wss:Security xmlns:wss="${WSS_NS}" xmlns:at="${AT_AUTH_NS}" at:Version="2">` +
    `<wss:UsernameToken>` +
    `<wss:Username>${escapeXml(token.username)}</wss:Username>` +
    `<wss:Password Digest="${escapeXml(token.digest)}">${escapeXml(token.password)}</wss:Password>` +
    `<wss:Nonce>${escapeXml(token.nonce)}</wss:Nonce>` +
    `<wss:Created>${escapeXml(token.created)}</wss:Created>` +
    `</wss:UsernameToken>` +
    `</wss:Security>`
  );
}

export { AT_USERNAME } from "./username";
