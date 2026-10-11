import crypto from "crypto";

import { decryptPII } from "@/lib/utils/pii-encryption";
import { totpVerify } from "@/lib/utils/totp";

/** The fields of a user the check reads. */
export interface SecondFactorUser {
  totpSecret: string | null;
  totpBackupCodes: string | null;
}

const hashCode = (code: string): string => crypto.createHash("sha256").update(code).digest("hex");

/**
 * Whether `code` is a live authenticator code or an unspent backup code for this user.
 *
 * It spends nothing: the caller decides what an accepted code is for. A secret or a list that
 * cannot be read proves nothing, and the other half may still, so a failure of one is not a failure
 * of both. The callers meter guesses with `totpGuessLimit`, which this does not.
 */
export function provesSecondFactor(user: SecondFactorUser, rawCode: string): boolean {
  const code = rawCode.replace(/\s/g, "");

  if (code.length === 6 && user.totpSecret) {
    try {
      if (totpVerify(code, decryptPII(user.totpSecret))) return true;
    } catch {
      // A secret that cannot be read proves nothing; the backup codes may still.
    }
  }

  if (user.totpBackupCodes) {
    try {
      const codes = JSON.parse(decryptPII(user.totpBackupCodes)) as string[];
      return codes.includes(hashCode(code.toUpperCase()));
    } catch {
      return false;
    }
  }
  return false;
}
