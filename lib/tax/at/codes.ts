/**
 * What an AT response code means for the person reading it.
 *
 * The codes are the manual's, the same for every operation (§4.2). Grouped by what the owner can
 * do about them, since that is what the screen has to say: fix the username, fix the password,
 * fix the files or the key, fix the clock, or wait for AT.
 */

export type AtCodeCategory =
  /** 0: the operation succeeded. */
  | "ok"
  /** −1: authenticated, but AT refused the data (or, for `obterRecibo`, found no such receipt). */
  | "rejected"
  /** 1–5: the username is missing or malformed, or names an invalid NIF. */
  | "username"
  /** 6, 13, 99: the password is missing, malformed or wrong, or the access is suspended. */
  | "password"
  /** 7, 8, 11, 12, 16, 17, 18, 20: the encryption failed; usually AT's public key file. */
  | "key"
  /** 9, 10, 19: the timestamp; usually the server's clock. */
  | "clock"
  /** 33: AT could not read the SOAP request. */
  | "request"
  /** −99: an internal error at AT. */
  | "at_fault"
  | "unknown";

const BY_CODE = new Map<number, AtCodeCategory>([
  [0, "ok"],
  [-1, "rejected"],
  [1, "username"],
  [2, "username"],
  [3, "username"],
  [4, "username"],
  [5, "username"],
  [6, "password"],
  [13, "password"],
  [99, "password"],
  [7, "key"],
  [8, "key"],
  [11, "key"],
  [12, "key"],
  [16, "key"],
  [17, "key"],
  [18, "key"],
  [20, "key"],
  [9, "clock"],
  [10, "clock"],
  [19, "clock"],
  [33, "request"],
  [-99, "at_fault"],
]);

export function categorize(code: number): AtCodeCategory {
  return BY_CODE.get(code) ?? "unknown";
}

/** Whether the code proves the credentials were accepted: AT answered past authentication. */
export function authenticated(code: number): boolean {
  const category = categorize(code);
  return category === "ok" || category === "rejected";
}
