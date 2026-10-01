/**
 * TOTP helpers wrapping otplib v13 functional API.
 * Centralises the import so API changes are isolated here.
 */
import { generateSecret as _generateSecret, generateSync, verifySync, generateURI } from "otplib";

export function totpGenerateSecret(): string {
  return _generateSecret();
}

export function totpGenerate(secret: string): string {
  const result = generateSync({ secret });
  if (typeof result === "string") return result;
  if (result && typeof (result as { value?: string }).value === "string") {
    return (result as { value: string }).value;
  }
  throw new Error("generateSync returned unexpected type");
}

export function totpVerify(token: string, secret: string): boolean {
  // otplib throws on a token that is not six digits, which would turn a caller's mistake (letters
  // typed into the box) into a 500 on the two routes that verify one.
  if (!/^\d{6}$/.test(token)) return false;
  const result = verifySync({ token, secret });
  if (typeof result === "boolean") return result;
  if (result && typeof result === "object") {
    return (result as { valid?: boolean }).valid ?? false;
  }
  return false;
}

export function totpKeyuri(label: string, issuer: string, secret: string): string {
  return generateURI({ label, issuer, secret });
}
