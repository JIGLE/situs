import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import type { PasskeySummary } from "@/lib/services/auth/passkey";

/**
 * Why a passkey step did not finish, in terms the screen can word itself (the server's own words are
 * English and never shown):
 *  - `cancelled`: the person dismissed the prompt, or it timed out. Not an error to scold anyone for.
 *  - `unsupported`: this browser or this address cannot make passkeys (a passkey needs https, or localhost).
 *  - `invalid`: the server did not accept it (a wrong code, an expired request).
 *  - `tooMany`: the account's budget is spent.
 *  - `duplicate`: this device's passkey is already saved.
 *  - `limit`: the account holds as many as it may.
 *  - `generic`: anything else.
 */
export type PasskeyProblem =
  "cancelled" | "unsupported" | "invalid" | "tooMany" | "duplicate" | "limit" | "generic";

export class PasskeyError extends Error {
  constructor(readonly problem: PasskeyProblem) {
    super(problem);
    this.name = "PasskeyError";
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

function problemOfStatus(status: number, reason: unknown): PasskeyProblem {
  if (status === 429) return "tooMany";
  if (reason === "passkey_exists") return "duplicate";
  if (reason === "passkey_limit") return "limit";
  if (status === 400) return "invalid";
  return "generic";
}

/** What the browser throws when the person backs out: NotAllowedError, or AbortError on a timeout. */
function problemOfBrowser(err: unknown): PasskeyProblem {
  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "cancelled";
  if (name === "NotSupportedError" || name === "SecurityError") return "unsupported";
  return "generic";
}

async function post(url: string, body: unknown, csrfToken?: string | null) {
  const res = await fetch(url, {
    method: "POST",
    headers: csrfToken ? { ...JSON_HEADERS, "X-CSRF-Token": csrfToken } : JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const reason = ((await res.json().catch(() => null)) as { reason?: unknown } | null)?.reason;
    throw new PasskeyError(problemOfStatus(res.status, reason));
  }
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * Sign in with a passkey: the second step of a sign-in, in place of the code. Resolves with the proof
 * `totp/verify` would have given (`mfa-proof.ts`), which the page hands to its own session.
 */
export async function signInWithPasskey(): Promise<string> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError("unsupported");

  const started = await post("/api/auth/passkey/authenticate/options", {});
  let response;
  try {
    response = await startAuthentication({
      optionsJSON: started.options as PublicKeyCredentialRequestOptionsJSON,
    });
  } catch (err) {
    throw new PasskeyError(problemOfBrowser(err));
  }

  const done = await post("/api/auth/passkey/authenticate/verify", {
    token: started.token,
    response,
  });
  if (typeof done.proof !== "string") throw new PasskeyError("generic");
  return done.proof;
}

/** Save a passkey on this device. Takes a code from the authenticator app, as the server requires. */
export async function addPasskey(args: {
  code: string;
  name: string;
  csrfToken: string | null;
}): Promise<PasskeySummary> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError("unsupported");

  const started = await post(
    "/api/auth/passkey/register/options",
    { code: args.code },
    args.csrfToken,
  );
  let response;
  try {
    response = await startRegistration({
      optionsJSON: started.options as PublicKeyCredentialCreationOptionsJSON,
    });
  } catch (err) {
    throw new PasskeyError(problemOfBrowser(err));
  }

  const done = await post(
    "/api/auth/passkey/register/verify",
    { token: started.token, name: args.name, response },
    args.csrfToken,
  );
  return done.passkey as PasskeySummary;
}
