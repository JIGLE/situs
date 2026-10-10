/**
 * TOTP helpers wrapping otplib v13 functional API.
 * Centralises the import so API changes are isolated here.
 */
import { generateSecret as _generateSecret, generateSync, verifySync, generateURI } from "otplib";

export function totpGenerateSecret(): string {
  return _generateSecret();
}

/**
 * `epoch` is seconds since 1970 and defaults to now; it exists so a test can ask for the code of
 * another moment instead of waiting for one.
 */
export function totpGenerate(secret: string, epoch?: number): string {
  const result = generateSync(epoch === undefined ? { secret } : { secret, epoch });
  if (typeof result === "string") return result;
  if (result && typeof (result as { value?: string }).value === "string") {
    return (result as { value: string }).value;
  }
  throw new Error("generateSync returned unexpected type");
}

/**
 * How far either side of now a code is still accepted, in seconds: one 30-second step.
 *
 * otplib's default is none, so only the code of the current step passed and a phone or server clock
 * a few seconds out, or a code typed as the step rolled over, answered "incorrect" to the right
 * code. RFC 6238 §5.2 asks a verifier to allow for that drift, and an authenticator's own clock is
 * never exactly the server's. The guess budget is unchanged (`totp-guess-limit.ts`: five tries
 * per fifteen minutes), so the window adds two valid values, not guesses.
 */
export const CLOCK_TOLERANCE_SECONDS = 30;

export function totpVerify(token: string, secret: string, epoch?: number): boolean {
  // otplib throws on a token that is not six digits, which would turn a caller's mistake (letters
  // typed into the box) into a 500 on the two routes that verify one.
  if (!/^\d{6}$/.test(token)) return false;
  const result = verifySync({
    token,
    secret,
    epochTolerance: CLOCK_TOLERANCE_SECONDS,
    ...(epoch === undefined ? {} : { epoch }),
  });
  if (typeof result === "boolean") return result;
  if (result && typeof result === "object") {
    return (result as { valid?: boolean }).valid ?? false;
  }
  return false;
}

export function totpKeyuri(label: string, issuer: string, secret: string): string {
  return generateURI({ label, issuer, secret });
}
