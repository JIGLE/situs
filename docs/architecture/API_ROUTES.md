# API Routes

Situs exposes **39 API domains** across **105 `route.ts` files** under `app/api/`, organised by
domain per Next.js App Router convention.

This document describes **18 of those domains in detail** — the ones whose contracts are not
obvious from the handler. It is not, and does not try to be, an endpoint-by-endpoint reference
for all 105: a hand-maintained one goes stale on the first PR that adds a route, and this file
spent a while claiming to cover "all" routes while omitting most of them. (The count was 26 for
a while because it counted `###` headings, two of which are the response-format sections at the
bottom rather than domains.)

**The filesystem is the source of truth.** To see what exists right now:

```bash
find app/api -name route.ts | sort
```

## Every domain

Generated from the route files. Methods are the HTTP verbs exported anywhere in the domain, so
a domain listing `GET POST` may still have some paths that only answer `GET`.

| Domain                 | Route files | Methods               |
| ---------------------- | ----------- | --------------------- |
| `/api/activation`      | 1           |                       |
| `/api/admin`           | 5           |                       |
| `/api/audit-trail`     | 1           |                       |
| `/api/auth`            | 6           | GET POST DELETE       |
| `/api/bank`            | 8           |                       |
| `/api/billing`         | 3           | GET                   |
| `/api/buildings`       | 2           |                       |
| `/api/compliance`      | 4           | POST                  |
| `/api/contracts`       | 1           | GET POST              |
| `/api/cron`            | 3           | GET POST              |
| `/api/csrf-token`      | 1           | GET                   |
| `/api/debug`           | 6           | GET POST              |
| `/api/distributions`   | 2           | GET POST              |
| `/api/documents`       | 1           |                       |
| `/api/email`           | 3           | GET POST PUT          |
| `/api/events`          | 1           |                       |
| `/api/exchange`        | 1           | GET                   |
| `/api/expenses`        | 3           |                       |
| `/api/finance`         | 2           | GET                   |
| `/api/fiscal`          | 1           | GET POST              |
| `/api/health`          | 3           | GET                   |
| `/api/info`            | 1           | GET                   |
| `/api/leases`          | 5           | GET POST PATCH DELETE |
| `/api/metrics`         | 1           | GET                   |
| `/api/monitoring`      | 5           | GET                   |
| `/api/notifications`   | 3           | GET POST PUT DELETE   |
| `/api/owners`          | 1           |                       |
| `/api/properties`      | 3           |                       |
| `/api/property-owners` | 1           |                       |
| `/api/ready`           | 1           | GET                   |
| `/api/receipts`        | 5           |                       |
| `/api/settings`        | 1           | GET POST              |
| `/api/tax`             | 3           | GET POST              |
| `/api/tax-filings`     | 3           | GET POST DELETE       |
| `/api/tax-rules`       | 2           | GET POST PUT DELETE   |
| `/api/tenants`         | 4           | GET POST DELETE       |
| `/api/units`           | 2           | GET PUT DELETE        |
| `/api/user`            | 4           | GET POST              |
| `/api/webhooks`        | 2           | POST                  |

## Route Organization

Routes are organised by domain following Next.js App Router conventions, all under `app/api/`.
The three `*.test.ts` files at the top level of `app/api/` are cross-cutting contract tests
(tenant scoping, error-status consistency, error-message leakage), not routes.

## Authentication

Most routes require authentication via NextAuth.js. Protected routes will return `401 Unauthorized` if not authenticated.

### Auth Routes

- `POST /api/auth/[...nextauth]` - NextAuth.js authentication handlers
- `GET /api/auth/signin` - Sign-in page

The error page is `/auth/error`, which is what `pages.error` in `lib/services/auth/auth.ts`
points at. A second copy used to sit at `/api/auth/error`, shadowing NextAuth's own built-in
error endpoint; it was deleted in PR #352.

## Core Resources

### Properties

- `GET /api/properties` - List all properties
- `POST /api/properties` - Create a new property
- `GET /api/properties/[id]` - Get property details
- `PUT /api/properties/[id]` - Update property
- `DELETE /api/properties/[id]` - Delete property

### Units

- `GET /api/units` - List all units
- `POST /api/units` - Create a new unit
- `GET /api/units/[id]` - Get unit details
- `PUT /api/units/[id]` - Update unit
- `DELETE /api/units/[id]` - Delete unit

### Tenants

- `GET /api/tenants` - List all tenants
- `POST /api/tenants` - Create a new tenant
- `GET /api/tenants/[id]` - Get tenant details
- `PUT /api/tenants/[id]` - Update tenant
- `DELETE /api/tenants/[id]` - Delete tenant
- `POST /api/tenants/[id]/portal-link` - Generate tenant portal access link

### Owners

- `GET /api/owners` - List all owners
- `POST /api/owners` - Create a new owner
- `GET /api/owners/[id]` - Get owner details
- `PUT /api/owners/[id]` - Update owner
- `DELETE /api/owners/[id]` - Delete owner

### Leases

- `GET /api/leases` - List all leases
- `POST /api/leases` - Create a new lease
- `GET /api/leases/[id]` - Get lease details
- `PUT /api/leases/[id]` - Update lease
- `DELETE /api/leases/[id]` - Delete lease

## Financial

### Receipts

- `GET /api/receipts/[id]/archive` - The id of this receipt's archived PDF, or 404. Resolution
  only; the bytes come from `/api/documents/[id]/download`. A 404 is the ordinary answer for a
  receipt that has not reached `emitted`, and the caller falls back to rendering a copy
  client-side.

- `GET /api/receipts` - List all receipts
- `POST /api/receipts` - Create a new receipt
- `GET /api/receipts/[id]` - Get receipt details
- `PUT /api/receipts/[id]` - Update receipt
- `DELETE /api/receipts/[id]` - Delete receipt

### Expenses

- `GET /api/expenses` - List all expenses
- `POST /api/expenses` - Create a new expense
- `GET /api/expenses/[id]` - Get expense details
- `PUT /api/expenses/[id]` - Update expense
- `DELETE /api/expenses/[id]` - Delete expense

## Communication

### Email

Transactional mail only, since the scope cutdown removed correspondence: rent reminders and
overdue notices dispatched by `lib/services/notifications/reminder-email.ts`, plus the delivery
log the Brevo webhook updates.

- `POST /api/email` - Send email
- `GET /api/email/logs` - Get email logs
- `GET /api/email/metrics` - Get email metrics

## Operations

### Documents

The browsing UI and its routes went with the scope cutdown. What remains is the read path for a
receipt's archived PDF — the proof of a filing made at Finanças — which the Receipts screen
reaches through `/api/receipts/[id]/archive`.

- `GET /api/documents/[id]/download` - Download an archived document

## Analytics & Reporting

### Metrics

- `GET /api/metrics` - Get application metrics
- `GET /api/metrics/performance` - Performance metrics

## Tax & Compliance

### Tax

- `POST /api/tax/saft-pt` - Generate SAF-T PT (Portuguese tax format)
- `GET /api/tax/saft-pt/download` - Download SAF-T PT file

### Webhooks

- `POST /api/webhooks/brevo` - Brevo delivery-event webhook. Requires `BREVO_WEBHOOK_SECRET`:
  Brevo does not sign its requests, so a shared secret is the only authentication.
- `POST /api/webhooks/stripe` - Stripe webhook handler, subscription-billing events only;
  anything else is acknowledged and dropped so Stripe does not retry it

## System

### Health

- `GET /api/health` - Overall system health check
- `GET /api/health/db` - Database health check
- `GET /api/health/email` - Email service health check

### Info

- `GET /api/info` - Get API version and info

### Admin

Read-only instance diagnostics for the owner account, plus the one destructive call that clears a
test connection. Everything here answers "what is actually wired up", which is why each is a `GET`.

- `GET /api/admin/system-status` - What is connected, what is simulated, what is broken. Derives
  each row from live state rather than asserting it.
- `GET /api/admin/sign-in-status` - How anyone can get in, and whether registration is closed.
- `GET /api/admin/bank-provider-check` - Asks each configured bank provider about its own setup.
- `GET /api/admin/bank-test-connections` - The connections made to prove the PSD2 chain works.
- `DELETE /api/admin/bank-test-connections/[id]` - Discard one test connection.

### Debug (Development Only)

- `GET /api/debug/auth` - Debug authentication state
- `POST /api/debug/auth-reset` - Reset authentication
- `GET /api/debug/db` - Database debug info
- `POST /api/debug/db/init` - Initialize database with seed data
- `GET /api/debug/env-check` - Environment variable check

### User Data

- `GET /api/user/export-data` - Export user data (GDPR compliance)
- `DELETE /api/user/delete-data` - Delete user data (GDPR compliance)

## Response Formats

All API routes follow consistent response formats:

### Success Response

```json
{
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Response

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

## Rate Limiting

All public-facing API routes are protected by rate limiting:

- Default: 100 requests per 15 minutes per IP
- Webhook endpoints: No rate limiting
- Protected routes: 1000 requests per hour per authenticated user

## CORS

CORS is configured to allow requests from the application domain only.

## Security

- All routes use HTTPS in production
- Authentication via NextAuth.js with session tokens
- CSRF protection enabled
- Input validation using Zod schemas
- SQL injection protection via Prisma ORM
- XSS protection via input sanitization

## Testing

API routes have co-located test files:

- Unit tests: `*.test.ts` files alongside route handlers
- Integration tests: Located in `e2e/` directory
- Load tests: Run via Artillery (see `scripts/load-test.yml`)

## Further Documentation

- [Security guide](../SECURITY.md) — auth, HMAC enforcement, secrets
- [Deployment Guide](../deployment.md) — Docker
- [TrueNAS SCALE Guide](../truenas.md)
