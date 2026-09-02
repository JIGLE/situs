# Security Guide

This document covers security best practices for deploying and operating Situs.

## Update webhook

The `/api/updates` webhook and related HMAC/bearer flows have been removed from Situs.

Releases should be handled via your CI/CD or operator processes. To integrate release notifications in future, implement a protected endpoint (HMAC or bearer) and update the deployment documentation and CI workflows to send authenticated POSTs to that endpoint.

## Init Endpoint Hardening (`/api/debug/db/init`)

This endpoint runs `prisma db push` and `prisma generate` — it **must** be protected in production.

### Production requirements

When `NODE_ENV=production`, the endpoint requires one of:

| Method | Header                                | Example                                                                      |
| ------ | ------------------------------------- | ---------------------------------------------------------------------------- |
| Bearer | `Authorization: Bearer <INIT_SECRET>` | `curl -H "Authorization: Bearer $INIT_SECRET" -X POST .../api/debug/db/init` |
| HMAC   | `X-Signature: <hmac-sha256-hex>`      | See README for computation                                                   |

**Generate a strong secret:**

```bash
openssl rand -hex 32
```

### Deployment checklist

- [ ] `INIT_SECRET` is supplied through the `.env` file Docker reads via `env_file`, never baked into the image
- [ ] `NODE_ENV=production` is set
- [ ] The endpoint is not exposed to the public internet (use internal service or VPN)
- [ ] After initial setup, consider disabling the endpoint entirely

## Secrets Management in CI/CD

### Do NOT echo secrets

```yaml
# BAD — leaks secret in logs
- run: echo "Secret is ${{ secrets.MY_SECRET }}"

# GOOD — use secrets only in env vars, never echo
- run: curl -H "Authorization: Bearer $MY_SECRET" https://example.com/api
  env:
    MY_SECRET: ${{ secrets.MY_SECRET }}
```

### Deployment secrets

Situs deploys as a single Docker container (`docker-compose.yml`, or a TrueNAS SCALE Custom
App). There is no Helm chart and no Kubernetes manifests — the chart was removed in favour of
one Docker path — so secrets are supplied through the env file Compose reads:

```bash
# .env, referenced by docker-compose.yml's `env_file:` — never commit it
NEXTAUTH_SECRET=$(openssl rand -base64 32)
PII_ENCRYPTION_KEY=$(openssl rand -hex 32)
INIT_SECRET=$(openssl rand -hex 32)
```

`PII_ENCRYPTION_KEY` is not optional in production: `lib/utils/env.ts` exits on boot without
it, because `encryptPII` silently returns plaintext when the key is absent.

One secret deliberately does **not** go in the env file. The Enable Banking RSA key is mounted
as a file and pointed at by `ENABLE_BANKING_PRIVATE_KEY_FILE` — a PEM is ~1,700 characters,
past TrueNAS' 1,000-character field cap, and mounting also keeps it out of
`/proc/<pid>/environ`.

### GitHub Actions secrets

- Store secrets in **Settings → Secrets and variables → Actions**
- Use `${{ secrets.SECRET_NAME }}` in workflows
- GitHub automatically masks secret values in logs
- Never use `echo` or `cat` on files containing secrets

## Rate Limiting

Rate limiting is applied per route by the handlers themselves, and the limits are declared in
code — there are no rate-limit environment variables. Two implementations are live, which is
worth knowing before you add a third:

| Module                         | Export                     | Used by                                               | Backing store                                  |
| ------------------------------ | -------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `lib/utils/rate-limit.ts`      | `withRateLimit`            | ~48 routes (admin, bank, compliance, CRUD)            | in-process `Map`                               |
| `lib/middleware/rate-limit.ts` | `rateLimit` + `RateLimits` | payments, the Stripe/SIBS/Bizum webhooks, TOTP verify | Redis when `REDIS_URL` is set, else in-process |

`REDIS_URL` is optional and only changes where the second one keeps its counters. Without it
both hold state in process: correct for a single self-hosted instance, but the counters reset
on restart and are not shared across replicas.

Both resolve the client IP through `resolveClientIp` (`lib/utils/security.ts`), which counts
`X-Forwarded-For` from the right. Reading it from the left — as one of them once did — lets a
caller choose their own bucket per request and defeats the limit entirely.

## Security Headers

The app sets these itself, on every response, in `proxy.ts` — you do not need a reverse proxy
to add them, and a proxy that sets them again will simply overwrite identical values:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload   (production only)
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<per-request>' ...
```

The CSP is nonce-based rather than `unsafe-inline` for scripts: `proxy.ts` generates a nonce
per request and passes it to the app through the `x-nonce` header. `style-src` still carries
`'unsafe-inline'`, which React DOM and Framer Motion require.

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it privately via GitHub Security Advisories or email the maintainers directly. Do not open public issues for security vulnerabilities.
