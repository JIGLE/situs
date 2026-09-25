# Situs Documentation Index

Every `.md` under `docs/` is listed here, and `scripts/check-docs.js` fails the build on one that
is not. Add a doc → add its link here, in the same commit.

Point-in-time records — audits, readiness reports, implementation notes — are deleted rather than
archived; `git log --diff-filter=D --name-only` finds them.

## Getting started

- [Quick start & README](../README.md) — install, run, deploy
- [.env.example](../.env.example) — every environment variable, with defaults
- [CLAUDE.md](../CLAUDE.md) — architecture, key patterns, CI gates, repository hygiene rules
- [Roadmap](../ROADMAP.md) — shipped work and the Decisions Log
- [Dev auth setup](DEV_AUTH_SETUP.md) — run the app without a database (`NEXT_PUBLIC_DEV_AUTH`)

## Deployment and operations

- [TrueNAS SCALE](truenas.md) — the deployment guide: image channels, storage, environment, bank
  setup, updating and upgrading, troubleshooting
- [Database strategy](DATABASE_STRATEGY.md) — how the schema reaches a database, backups, and the
  SQLite scale plan
- [Monitoring](MONITORING.md) — health endpoints, `/api/metrics`, the structured logger, and what
  is deliberately not wired
- [Workflow naming](workflow-naming.md) — CI and release workflow conventions

## Security and data protection

- [Security](SECURITY.md) — secrets, the init endpoint, CSRF, rate limiting, headers, scanning
- [Data protection](DATA_PROTECTION.md) — the Article 30 record: what personal data is held, which
  fields are encrypted, who else receives it, how long it is kept, and the known gaps

## Integrations

- [Email retry logic](EMAIL_RETRY_LOGIC.md)

Bank movements, which arrive through a live PSD2 feed from Enable Banking, are documented in [truenas.md](truenas.md#bank-movements) and `CLAUDE.md`,
because setup is deployment-shaped rather than integration-shaped.

## UX and accessibility

- [UI consistency guide](UI_CONSISTENCY_GUIDE.md)
- [Accessibility](ACCESSIBILITY.md) — WCAG 2.1 AA patterns, and the axe check in
  `e2e/situs-a11y.spec.ts`

## Testing

- [Unit and integration tests](../tests/README.md)
- [Playwright E2E](../e2e/README.md)

## Contributing

- [Repository procedures](REPOSITORY_PROCEDURES.md) — **authoritative** for branching, pull
  requests, Dependabot, releases and the session routine
- [Contributing guide](../CONTRIBUTING.md)
- [Code of conduct](../CODE_OF_CONDUCT.md)
