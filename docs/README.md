# Situs Documentation Index

**Every `.md` under `docs/` is listed here.** That is not a courtesy — it is enforced by
`scripts/check-docs.js`, which fails the build on any file in this directory that this index does
not reach. A doc nobody can find is a doc nobody maintains, and 24 of them had accumulated before
the rule existed.

Add a doc → add its link here, in the same commit.

## Getting started

- [Quick start & README](../README.md) — install, run, deploy
- [.env.example](../.env.example) — every environment variable with defaults
- [CLAUDE.md](../CLAUDE.md) — architecture, key patterns, CI gates, repo hygiene rules
- [Roadmap](../ROADMAP.md) — the **only** roadmap: shipped work plus the authoritative Decisions Log
- [Dev auth setup](DEV_AUTH_SETUP.md) — run the app without a database (`NEXT_PUBLIC_DEV_AUTH`)

## Pilot readiness

- [V1 checklist](V1_CHECKLIST.md) — living tracker; what is open and what closed it
- [V1 readiness assessment](V1_READINESS.md) — the dated review that produced the checklist

Both carry an **integration status block**. Those lines are claims with an expiry: the commit that
makes one false is the commit that rewrites it.

## Strategy & audits

Dated, point-in-time, and still load-bearing where noted:

- [Product audit 2026](PRODUCT_AUDIT_2026.md) — product strategy, habit model, North Star.
  §5 is cited by `CLAUDE.md` for PII wiring status
- [UX audit 2026](UX_AUDIT_2026.md) — canonical IA and the reconciled backlog table
- [Architecture & governance audit 2026](ARCHITECTURE_GOVERNANCE_AUDIT_2026.md) — per-screen
  density plus docs-vs-code drift
- [Mobile UX audit](MOBILE_UX_AUDIT.md) — mobile-first behavioural findings
- [UX improvement plan](UX_IMPROVEMENT_PLAN.md)
- [Design award](DESIGN_AWARD.md) — visual/token craft loop and scorecard

## Deployment

- [Docker deployment](deployment.md)
- [TrueNAS SCALE](truenas.md) — the full guide: image channels, storage, bank setup, troubleshooting
- [Troubleshooting](troubleshooting.md)
- [Production deployment checklist](PRODUCTION_DEPLOYMENT_CHECKLIST.md)
- [Workflow naming](workflow-naming.md) — CI/release conventions, and why superseded workflows are
  deleted rather than parked

## Architecture

- [Project structure](architecture/PROJECT_STRUCTURE.md)
- [API routes](architecture/API_ROUTES.md)
- [Optimization](architecture/OPTIMIZATION.md)
- [Database strategy](DATABASE_STRATEGY.md) — SQLite vs PostgreSQL, migrations, backups
- [Performance optimizations](PERFORMANCE_OPTIMIZATIONS.md)

## Security

- [Security guide](SECURITY.md) — HMAC enforcement, init endpoint hardening, secrets
- [Security testing](SECURITY_TESTING.md)
- [CSP nonce implementation](CSP_NONCE_IMPLEMENTATION.md)
- [CSRF integration](CSRF_INTEGRATION.md)

## Monitoring

- [Metrics & monitoring](METRICS_AND_MONITORING.md) — structured logging, Prometheus, Grafana
- [Monitoring setup](MONITORING_SETUP.md)
- [Monitoring quick reference](MONITORING_QUICK_REFERENCE.md)

## Integrations

- [Government verification](integrations/GOVERNMENT_VERIFICATION.md) — the ownership-verification
  scaffold behind `GovernmentVerification` / `PropertyVerificationClaim`
- [SendGrid webhooks](integrations/SENDGRID_WEBHOOKS.md)
- [Email retry logic](EMAIL_RETRY_LOGIC.md)
- [Bizum integration](BIZUM_INTEGRATION.md)
- [Redis rate limiting](REDIS_RATE_LIMITING.md)
- [Webhook templates](webhook-templates.md)

Bank movements — CSV import, and a live PSD2 feed through Enable Banking when the instance is
configured for one — are documented in [truenas.md](truenas.md#bank-movements) and `CLAUDE.md`,
because setup is deployment-shaped rather than integration-shaped. This line used to say "no
provider ships", which stopped being true when the Enable Banking adapter landed in PR #340.

## UX & accessibility

- [UI consistency guide](UI_CONSISTENCY_GUIDE.md)
- [Accessibility improvements](ACCESSIBILITY_IMPROVEMENTS.md)
- [Accessibility quick reference](ACCESSIBILITY_QUICK_REFERENCE.md)
- [Accessibility testing](ACCESSIBILITY_TESTING.md) — adding axe checks to Playwright
- [Storybook guide](ux/STORYBOOK_GUIDE.md)

## Testing

- [Load testing](LOAD_TESTING.md)
- [Security testing](SECURITY_TESTING.md)
- [Playwright E2E guide](../playwright/README.md)

## Contributing

- [Contributing guide](../CONTRIBUTING.md)
- [Code of conduct](../CODE_OF_CONDUCT.md)
- [Releases](../RELEASES.md) — historical ledger to v1.13.0; git tags and GitHub Releases are
  authoritative

## Where the archive went

`docs/archive/` (27 files) and `docs/archived-workflows/` (3 workflows) were **deleted** on
2026-08-17, along with 18 other point-in-time records — completed phase summaries, one-off migration
notes, release notes for 7 of 24 versions, and a second stale TrueNAS guide that competed with
`truenas.md`.

Git history retains all of it. An archive directory is a slower delete that still costs search
noise and reading time, and `docs/archive/README.md` had already made that argument itself while
deferring the call to the repository owner.

**The convention now: point-in-time records are deleted, not parked.** `git log --diff-filter=D
--name-only` finds anything you need.
