# API Routes

Situs exposes **50 API domains** across **154 `route.ts` files** under `app/api/`, organised by
domain per Next.js App Router convention.

This document describes **26 of those domains in detail** — the ones whose contracts are not
obvious from the handler. It is not, and does not try to be, an endpoint-by-endpoint reference
for all 154: a hand-maintained one goes stale on the first PR that adds a route, and this file
spent a while claiming to cover "all" routes while omitting 24 domains.

**The filesystem is the source of truth.** To see what exists right now:

```bash
find app/api -name route.ts | sort
```

## Every domain

Generated from the route files. Methods are the HTTP verbs exported anywhere in the domain, so
a domain listing `GET POST` may still have some paths that only answer `GET`.

| Domain                         | Route files | Methods                   |
| ------------------------------ | ----------- | ------------------------- |
| `/api/activation`              | 1           | GET                       |
| `/api/admin`                   | 10          | GET DELETE                |
| `/api/analytics`               | 1           | GET                       |
| `/api/audit-trail`             | 1           | GET                       |
| `/api/auth`                    | 6           | GET POST DELETE           |
| `/api/bank`                    | 8           | GET POST PUT              |
| `/api/billing`                 | 3           | GET                       |
| `/api/buildings`               | 2           | GET POST PUT DELETE       |
| `/api/compliance`              | 4           | GET POST                  |
| `/api/contacts`                | 2           | GET POST PUT DELETE       |
| `/api/contracts`               | 1           | GET POST                  |
| `/api/correspondence`          | 6           | GET POST PUT DELETE       |
| `/api/cron`                    | 3           | GET POST                  |
| `/api/csrf-token`              | 1           | GET                       |
| `/api/debug`                   | 6           | GET POST                  |
| `/api/demo`                    | 2           | GET POST                  |
| `/api/distributions`           | 2           | GET POST                  |
| `/api/documents`               | 8           | GET POST PUT DELETE       |
| `/api/email`                   | 3           | GET POST PUT              |
| `/api/events`                  | 1           | POST                      |
| `/api/exchange`                | 1           | GET                       |
| `/api/expenses`                | 3           | GET POST PUT DELETE       |
| `/api/finance`                 | 2           | GET                       |
| `/api/fiscal`                  | 1           | GET POST                  |
| `/api/health`                  | 3           | GET                       |
| `/api/info`                    | 1           | GET                       |
| `/api/invoices`                | 6           | GET POST PUT DELETE       |
| `/api/leases`                  | 5           | GET POST PUT PATCH DELETE |
| `/api/maintenance`             | 4           | GET POST PUT DELETE       |
| `/api/metrics`                 | 1           | GET                       |
| `/api/monitoring`              | 5           | GET                       |
| `/api/notifications`           | 3           | GET POST PUT DELETE       |
| `/api/owners`                  | 1           | GET POST                  |
| `/api/ownership-verifications` | 1           | GET POST                  |
| `/api/payments`                | 4           | GET POST DELETE           |
| `/api/portal`                  | 1           | GET                       |
| `/api/properties`              | 3           | GET POST PUT DELETE       |
| `/api/property-owners`         | 1           | POST DELETE               |
| `/api/ready`                   | 1           | GET                       |
| `/api/receipts`                | 4           | GET POST PUT DELETE       |
| `/api/reports`                 | 1           | GET POST                  |
| `/api/settings`                | 1           | GET POST                  |
| `/api/tax`                     | 3           | GET POST                  |
| `/api/tax-filings`             | 3           | GET POST DELETE           |
| `/api/tax-rules`               | 2           | GET POST PUT DELETE       |
| `/api/tenant-portal`           | 7           | GET POST PATCH            |
| `/api/tenants`                 | 5           | GET POST PUT DELETE       |
| `/api/units`                   | 2           | GET POST PUT DELETE       |
| `/api/user`                    | 4           | GET POST                  |
| `/api/webhooks`                | 4           | POST                      |

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

### Invoices

- `GET /api/invoices` - List all invoices
- `POST /api/invoices` - Create a new invoice
- `GET /api/invoices/[id]` - Get invoice details
- `PUT /api/invoices/[id]` - Update invoice
- `DELETE /api/invoices/[id]` - Delete invoice
- `POST /api/invoices/[id]/pay` - Mark invoice as paid
- `POST /api/invoices/[id]/initiate-payment` - Initialize payment process
- `POST /api/invoices/batch` - Batch create invoices
- `POST /api/invoices/late-fees` - Apply late fees to overdue invoices

### Payments

- `GET /api/payments` - List all payments
- `POST /api/payments` - Record a new payment
- `GET /api/payments/[id]` - Get payment details
- `PUT /api/payments/[id]` - Update payment
- `DELETE /api/payments/[id]` - Delete payment
- `GET /api/payments/methods` - Get available payment methods

### Receipts

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

### Correspondence

- `GET /api/correspondence` - List all correspondence
- `POST /api/correspondence` - Create correspondence
- `GET /api/correspondence/[id]` - Get correspondence details
- `PUT /api/correspondence/[id]` - Update correspondence
- `DELETE /api/correspondence/[id]` - Delete correspondence
- `POST /api/correspondence/generate` - Generate correspondence from template
- `GET /api/correspondence/templates` - List templates
- `GET /api/correspondence/templates/[id]` - Get template details

### Email

- `POST /api/email` - Send email
- `GET /api/email/logs` - Get email logs
- `GET /api/email/metrics` - Get email metrics

## Operations

### Maintenance

- `GET /api/maintenance` - List all maintenance requests
- `POST /api/maintenance` - Create maintenance request
- `GET /api/maintenance/[id]` - Get maintenance details
- `PUT /api/maintenance/[id]` - Update maintenance request
- `DELETE /api/maintenance/[id]` - Delete maintenance request

### Documents

- `GET /api/documents` - List all documents
- `POST /api/documents` - Upload a document
- `GET /api/documents/[id]` - Get document details
- `DELETE /api/documents/[id]` - Delete document
- `GET /api/documents/[id]/download` - Download document
- `POST /api/documents/generate` - Generate PDF document
- `GET /api/documents/stats` - Get document statistics

## Analytics & Reporting

### Analytics

- `GET /api/analytics` - Get analytics data
- `GET /api/analytics/dashboard` - Dashboard analytics
- `GET /api/analytics/revenue` - Revenue analytics
- `GET /api/analytics/occupancy` - Occupancy analytics

### Reports

- `GET /api/reports` - List available reports
- `POST /api/reports` - Generate a report
- `GET /api/reports/[id]` - Get report details

### Metrics

- `GET /api/metrics` - Get application metrics
- `GET /api/metrics/performance` - Performance metrics

## Tax & Compliance

### Tax

- `POST /api/tax/saft-pt` - Generate SAF-T PT (Portuguese tax format)
- `GET /api/tax/saft-pt/download` - Download SAF-T PT file

### Ownership Verification

- `GET /api/ownership-verifications` - List user-scoped ownership verification requests
- `POST /api/ownership-verifications` - Create a provider-agnostic ownership verification request scaffold

## Integrations

### Webhooks

- `POST /api/webhooks/sendgrid` - SendGrid webhook handler
- `POST /api/webhooks/stripe` - Stripe webhook handler

### Tenant Portal

- `GET /api/tenant-portal/[token]` - Get tenant portal data
- `POST /api/tenant-portal/[token]/pay` - Process tenant portal payment

## System

### Health

- `GET /api/health` - Overall system health check
- `GET /api/health/db` - Database health check
- `GET /api/health/email` - Email service health check

### Info

- `GET /api/info` - Get API version and info

### Admin

- `POST /api/admin/database` - Database admin operations (backup, restore, etc.)

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
- [SendGrid webhooks](../integrations/SENDGRID_WEBHOOKS.md)
- [Deployment Guide](../deployment.md) — Docker
- [TrueNAS SCALE Guide](../truenas.md)
