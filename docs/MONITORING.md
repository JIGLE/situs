# Monitoring

How to see what a running Situs instance is doing: the endpoints it exposes, the logger it
writes through, and what it deliberately does not do.

This replaces three earlier documents (`MONITORING_SETUP.md`, `MONITORING_QUICK_REFERENCE.md`,
`METRICS_AND_MONITORING.md`) that described the same endpoints three times and, between them,
specified a P1/P2/P3 on-call rotation, a PagerDuty schedule, a Slack alert channel, Grafana and
Sentry dashboards, and an `ops-team@` address. None of that exists. Situs is a single
self-hosted instance; the operator is the person reading this.

## What is actually wired

| Capability                 | State                                                                 |
| -------------------------- | --------------------------------------------------------------------- |
| Health endpoints           | **Live** — `/api/health`, `/api/health/db`, `/api/health/email`       |
| Prometheus-format metrics  | **Live** — `/api/metrics`, hand-rolled, no `prom-client` dependency   |
| Structured JSON logging    | **Live** — `lib/utils/logger.ts`                                      |
| In-process error tracking  | **Live** — `lib/monitoring/error-tracker.ts`, readable in development |
| Alerting / paging          | **Not wired.** Nothing sends a notification when a check fails        |
| Sentry / Grafana / Datadog | **Not wired.** No SDK is installed                                    |

Nothing polls these endpoints on your behalf. If you want to be told when the instance is down,
point an external uptime checker at `/api/health` — that is the integration point, and it is the
only piece you have to supply.

## Health endpoints

All three are unauthenticated and safe to expose to an uptime checker.

### `GET /api/health`

Combined check. Returns database and email status plus uptime and a response time. Expect
`200` with `"status": "ok"`.

```json
{
  "status": "ok",
  "timestamp": "2026-09-02T09:00:00.000Z",
  "uptime": 3600.5,
  "environment": "production",
  "checks": {
    "database": { "status": "healthy", "latency_ms": 12 },
    "email": { "status": "configured", "provider": "smtp" }
  },
  "response_time_ms": 15
}
```

A reasonable external check is every 30s, alerting on three consecutive failures or a response
slower than 5s. Three consecutive rather than one: a single SQLite write lock can push one
probe past its timeout without anything being wrong.

### `GET /api/health/db`

Database only, with query and transaction latency broken out. Useful when `/api/health` is
degraded and you want to know whether the database is the reason.

### `GET /api/health/email`

Whether an email provider is configured and reachable. Reports `configured` without sending
anything — a green result means the credentials are present and the provider answered, not that
delivery works end to end. `/api/email/logs` holds the actual send history.

## Metrics

`GET /api/metrics` emits Prometheus text format directly — there is no `prom-client` dependency
and none is needed:

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total 1024

# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds gauge
process_uptime_seconds 3600.5
```

Exposed series: `http_requests_total`, `http_errors_total`, `db_queries_total`,
`email_sent_total`, `email_failed_total`, `process_uptime_seconds`, and
`metrics_reset_timestamp_seconds`.

Two properties worth knowing before you build anything on it:

- **In production the endpoint requires a bearer token** — `Authorization: Bearer $INIT_SECRET`.
  Outside production it is open. A scraper configured without the header will get `401` from a
  production instance and nothing else will explain why.
- **The counters live in process.** They reset on every restart and every redeploy, which is
  what `metrics_reset_timestamp_seconds` is for. Treat them as rates since last boot, not as
  lifetime totals.

```bash
curl -H "Authorization: Bearer $INIT_SECRET" https://your-instance/api/metrics
```

## Structured logging

`lib/utils/logger.ts` writes JSON in production and coloured text otherwise.

| Env var     | Default                                 | Effect                                                    |
| ----------- | --------------------------------------- | --------------------------------------------------------- |
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Minimum level: `debug`, `info`, `warn`, `error`           |
| `NODE_ENV`  | —                                       | `production` → JSON output; anything else → coloured text |

```typescript
import { logger } from "@/lib/utils/logger";

logger.info("Request received", { path: "/api/health", method: "GET" });

// error() takes the error as its second argument, context third —
// passing { error: err.message } as the second argument loses the stack.
logger.error("Database write failed", err, { leaseId });

// child() presets context for every call made through it
const reqLogger = logger.child({ requestId: "abc-123", userId: "user-1" });
reqLogger.info("Processing payment"); // carries requestId and userId
```

Production output is one JSON object per line, so `docker logs` piped through `jq` is a usable
query tool without any log shipper:

```bash
docker compose logs -f app | jq 'select(.level == "error")'
```

## Error tracking

`lib/monitoring/error-tracker.ts` keeps recent errors in memory. `trackError` records one;
`withErrorTracking` wraps an async call; `getErrorStats` summarises what has accumulated.

`GET /api/monitoring/errors` reads it back, but **only when `NODE_ENV` is `development`** — it
returns early in production rather than exposing stack traces. In production the same
information reaches you through the JSON logs.

Like the metrics counters, this buffer is in-process and does not survive a restart.

## Operating checklist

Nothing here is automated; these are the things worth doing by hand.

- **After a deploy** — `curl -fsS https://your-instance/api/health | jq .status` should print
  `ok`. It is the one check that covers database and email together.
- **When something looks wrong** — `/api/health/db` first (is the database the cause?), then
  the error-level log lines above, then `/api/metrics` for whether `http_errors_total` is
  climbing or flat.
- **Backups** — health checks say nothing about your data surviving. `scripts/db-backup.sh` is
  the relevant tool; a health endpoint returning `ok` on an instance with no backups is exactly
  as green as one with them.

## What this deliberately leaves out

Alerting rules, dashboard templates, severity ladders and escalation paths were removed rather
than rewritten. They described a team, a rotation and a toolchain that this deployment does not
have, and a runbook for infrastructure nobody runs is worse than no runbook: it reads as though
someone is watching.

If Situs later runs somewhere that needs them, add them alongside the integration that makes
them real — a scrape config next to a Prometheus instance that exists, an alert rule next to the
receiver that fires it.
