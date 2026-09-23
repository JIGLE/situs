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
phone in plaintext, and `lib/utils/env.ts` stops the process with an error naming the variable
when a module that imports it loads. `ALLOW_UNENCRYPTED_PII=true` overrides that for a throwaway
instance.

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

## CSRF

`proxy.ts` rejects any `POST`, `PUT`, `PATCH` or `DELETE` to a non-public `/api/*` route unless the
`csrf-token` cookie matches the `x-csrf-token` header (double-submit). `GET /api/csrf-token` issues
the cookie, and `apiFetch` (`lib/utils/api-client.ts`) echoes it back. Public routes — webhooks
among them — skip the check and authenticate by signature or shared secret instead.

## Rate limiting

Rate limits are declared in code; there are no rate-limit environment variables. Three
implementations are live, which is worth knowing before you add a fourth:

| Where                            | Export                     | Used by                                            | Backing store                                  |
| -------------------------------- | -------------------------- | -------------------------------------------------- | ---------------------------------------------- |
| `lib/utils/rate-limit.ts`        | `withRateLimit`            | the routes that wrap their handler in it           | in-process `Map`                               |
| `lib/middleware/rate-limit.ts`   | `rateLimit` + `RateLimits` | the Stripe webhook, TOTP verify                    | Redis when `REDIS_URL` is set, else in-process |
| `app/api/debug/db/init/route.ts` | its own `isRateLimited`    | the init endpoint only — 5 requests per IP an hour | in-process `Map`                               |

`git grep -l withRateLimit app/api` lists the first one's users. `REDIS_URL` only changes where the
second keeps its counters. Without it every limiter holds state in process: correct for a single
self-hosted instance, but the counters reset on restart and are not shared across replicas.

The first two resolve the client IP through `resolveClientIp` (`lib/utils/security.ts`), which
counts `X-Forwarded-For` from the right. Reading it from the left lets a caller choose their own
bucket per request and defeats the limit — and the init endpoint's limiter still does exactly
that, which is tolerable only because the endpoint also demands a session and `INIT_SECRET`.

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
- **`npm run security:audit`** — `npm audit` at moderate and above; part of `npm run verify:ci`.
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
