# Security Guide

Hardening notes for operating a Situs instance. To report a vulnerability, see
[.github/SECURITY.md](../.github/SECURITY.md).

## Deployment secrets

Situs deploys as a single Docker container (`docker-compose.yml`, or a TrueNAS SCALE Custom App),
so secrets are supplied through the environment — for Compose, the env file it reads:

```bash
# .env, referenced by docker-compose.yml's `env_file:` — never commit it
NEXTAUTH_SECRET=$(openssl rand -base64 32)
PII_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

`PII_ENCRYPTION_KEY` is not optional in production. Without it `encryptPII` stores IBAN, NIF and
phone in plaintext, so the server refuses to start, with an error naming the variable:
`instrumentation.ts` runs `lib/utils/env.ts` before the first request, and the image's `prestart`
(`scripts/validate-env.js`) refuses before it touches the database. `ALLOW_UNENCRYPTED_PII=true`
overrides both for a throwaway instance.

One secret deliberately does **not** go in the environment. The Enable Banking RSA key is mounted
as a file and pointed at by `ENABLE_BANKING_PRIVATE_KEY_FILE` — a PEM is ~1,700 characters, past
TrueNAS' 1,000-character field cap, and a file also keeps it out of `/proc/<pid>/environ`.

## Database init endpoint (`/api/debug/db/init`)

The container creates and syncs its own schema on start (`prestart`), so this endpoint is a
fallback. It runs `prisma db push` and `prisma generate`.

- In production it answers 403 unless `INIT_SECRET` is set. Leave it unset unless you need it; on
  TrueNAS, `docker exec … npx prisma db push` does the same job (see [truenas.md](truenas.md)).
- With `INIT_SECRET` set, a request needs a signed-in session and a CSRF token — `proxy.ts` checks
  both before the route runs — plus `Authorization: Bearer <INIT_SECRET>` or an HMAC signature in
  `X-Signature`.
- Nothing else takes this secret. The counter endpoints, which need no session, have their own
  read-only `METRICS_TOKEN` (see [MONITORING.md](MONITORING.md#metrics)), so arming a scraper does
  not arm this endpoint.

## CSRF

`proxy.ts` rejects any `POST`, `PUT`, `PATCH` or `DELETE` to a non-public `/api/*` route unless the
`csrf-token` cookie matches the `x-csrf-token` header (double-submit). `GET /api/csrf-token` issues
the cookie, and `apiFetch` (`lib/utils/api-client.ts`) echoes it back. Public routes — webhooks
among them — skip the check and authenticate by signature or shared secret instead.

`/api/auth/**` is public to the proxy too, and holds routes that a session authenticates: the TOTP
routes that change state (`setup`, `enable`, `disable`) call `csrfProtection`
(`lib/middleware/csrf.ts`) themselves, and `app/api/auth/csrf-check.test.ts` names any handler there
that does not. `verify` is the one exception: a session waiting for its code need not hold a CSRF
cookie, since the proxy seeds it for portal pages, which that session is kept out of.

## Second factor

An account with an authenticator app (Settings › Security) has to enter a code at every sign-in.

- At sign-in the session gets `mfaPending` (`lib/services/auth/auth.ts`). While it is set,
  `proxy.ts` answers every API route outside `/api/auth/**` with 401 `mfa_required`, and sends every
  portal page to `/auth/mfa`. `requireAuth` refuses it as well, for a handler reached some other
  way. Read the session through `requireAuth`: the one route that reads it directly,
  `/api/auth/totp/verify`, is the one that has to accept a session still waiting for its code.
- The code page posts to `/api/auth/totp/verify`, which is rate limited per account and answers an
  accepted code with a proof made for the session that sent it (`lib/services/auth/mfa-proof.ts`: a
  MAC, under `NEXTAUTH_SECRET`, over the user and the session's `sid`, good for a minute). The page
  gives it to its own session, `update({ mfaProof })`, and the `jwt` callback clears `mfaPending`
  for a proof made for that session and for nothing else.
- A code releases the session that entered it and no other. A sign-in with only the password,
  made a moment after the owner's own, stays held. `User.totpVerifiedAt` is still written as a
  record of the last verification, and nothing reads it.
- A session held pending before it had a `sid` is given one at its next refresh, which the code page
  causes by reading the session; a code posted before that answers 401 `mfa_session_unnamed` and
  spends nothing.
- Signing in fails closed: a sign-in that cannot read whether the account has a second factor is
  refused (`MFA_STATE_UNREADABLE`), not let in as a full session. The code page leaves only when
  `update` answers a session that is no longer pending, since next-auth answers `null` rather than
  throwing when that call fails.
- The code limiter is per account, not per session, which is what stops guessing across sessions. It
  also means a sign-in with only the password that keeps posting wrong codes keeps the owner's code
  page at 429.
- `setup` (a POST), `enable` and `disable` check the CSRF token themselves (see CSRF above).
  `setup` writes its pending secret only while the second factor is off and answers 409
  `totp_already_enabled` otherwise, so it cannot switch an enabled one off or replace its secret.
  `enable` turns it on only for the secret its code was checked against, and answers 409
  `totp_setup_changed` when a `disable` or a new `setup` got in between.
- Turning it off (`DELETE /api/auth/totp/disable`) takes a code from the factor, an authenticator
  code or a backup code, because the session that asks may be a stolen one: `mfaPending` is set
  only at sign-in, so a cookie that was open before the factor was turned on, or one that passed it,
  is all `requireAuth` can tell. A wrong or missing code, or a secret that cannot be read, is a 400 and changes nothing. Guesses
  are counted per account, not per URL: `verify` and `disable` name one rate-limit scope
  (`totpGuessLimit`, `lib/services/auth/totp-guess-limit.ts`), so five wrong codes in fifteen minutes
  at either use both up, and a test runs the real limiter to prove it. The cost is that someone with
  only the password, who can already burn the sign-in budget, can also hold off `disable` for those
  fifteen minutes. The clear is conditional on the secret and on `totpEnabled` as they were read, so
  an owner confirming a setup at that moment turns a code-less clear into a 409. A setup that was
  never confirmed has no factor to prove and is cleared without a code. Ending the older sessions
  when the factor is turned on is not built: it needs a per-account session marker the JWT callback
  checks.
- An accepted TOTP code is not single-use within its 30 seconds, and a backup code is spent by a
  read and a write that two concurrent posts can both pass. Both need a code in hand.

## IBAN hashes

Matching never reads an IBAN: it compares stored hashes (`BankAccount.ibanHash`,
`BankTransaction.counterpartyIbanHash`, `PayerAccount.ibanHash`, an `iban_hash` rule's value, and the
movement fingerprint, which embeds one). A plain SHA-256 of an IBAN can be reversed by hashing the
candidates, about a billion per bank and branch in Portugal, so these are keyed: `v2:` +
HMAC-SHA256 under a key HKDF-derived from `PII_ENCRYPTION_KEY` (`lib/utils/iban-hash.ts`). A stolen
copy of the database alone no longer yields the numbers; the database together with the key does, but
the key also decrypts `iban` itself, so that case loses nothing more. Stored plain hashes convert at
every start without the IBAN (`iban-hash-migration.ts`; a fingerprint is rebuilt only after the old one
is reproduced from the row and found equal, otherwise it is kept). Without a key a hash stays plain,
beside IBANs stored unencrypted. Changing the key changes every hash and nothing recognises a known
account until the old one is back; Admin › Status (`iban_hash`) reports plain hashes left under a key
and keyed hashes without one.

## Rate limiting

Rate limits are declared in code; no environment variable sets one. Two change how they behave:
`TRUSTED_PROXY_COUNT` (below), and `E2E_DISABLE_RATE_LIMIT=true`, which switches the first two off
so a test run from one address is not throttled — never set it on a real instance. Three
implementations are live, which is worth knowing before you add a fourth:

| Where                            | Export                     | Used by                                            | Backing store                                  |
| -------------------------------- | -------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `lib/utils/rate-limit.ts`        | `withRateLimit`            | the routes that wrap their handler in it           | in-process `Map`                               |
| `lib/middleware/rate-limit.ts`   | `rateLimit` + `RateLimits` | TOTP verify                                        | Redis when `REDIS_URL` is set, else in-process |
| `app/api/debug/db/init/route.ts` | its own `isRateLimited`    | the init endpoint only — 5 requests per IP an hour | in-process `Map`                               |

`git grep -l withRateLimit app/api` lists the first one's users. `REDIS_URL` only changes where the
second keeps its counters. Without it every limiter holds state in process: correct for a single
self-hosted instance, but the counters reset on restart and are not shared across replicas.

All three resolve the client IP through `resolveClientIp` (`lib/utils/security.ts`), which
counts `X-Forwarded-For` from the right, trusting as many hops as `TRUSTED_PROXY_COUNT` says
(default 1). Reading it from the left would let a caller choose their own bucket per request and
defeat the limit — or pick someone else's bucket and exhaust it.

## Security headers

The app sets these itself, on every response, in `proxy.ts` — you do not need a reverse proxy to
add them, and a proxy that sets them again will simply overwrite identical values:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload   (production only)
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<per-request>' ...
```

The CSP is nonce-based rather than `unsafe-inline` for scripts: `proxy.ts` generates a nonce per
request and passes it to the app in the `x-nonce` header, and the root layout emits it as
`<meta name="csp-nonce">`. `style-src` still carries `'unsafe-inline'`, which React DOM and Framer
Motion require.

## Scanning

- **CI** — `security-scan.yml` runs on pull requests, on pushes to `main` and daily: `npm audit`,
  `scripts/security-scan.js`, CodeQL, dependency review and TruffleHog.
- **`npm run security:audit`** — `scripts/audit-gate.js`, the same rule CI applies: a critical or high advisory in a
  package the app ships fails, a critical one in the tooling fails, and a high one in the tooling only warns; part of
  `npm run verify:ci`.
- **`npm run security:zap`** — an OWASP ZAP scan (`scripts/zap-scan.js`) against a running
  instance. It needs ZAP running locally (`ZAP_URL`, `ZAP_API_KEY`) and is not run in CI.

## Secrets in CI

Store secrets in **Settings → Secrets and variables → Actions** and pass them to steps through
`env:`. Never `echo` or `cat` one — masking catches the literal value, not every transformation of
it.

```yaml
# BAD — leaks the secret into the log
- run: echo "Secret is ${{ secrets.MY_SECRET }}"

# GOOD — the step reads it from its environment
- run: curl -H "Authorization: Bearer $MY_SECRET" https://example.com/api
  env:
    MY_SECRET: ${{ secrets.MY_SECRET }}
```
