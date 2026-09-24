# Monitoring

How to see what a running Situs instance is doing: the endpoints it exposes, the logger it
writes through, and what it deliberately does not do.

Situs is a single self-hosted instance; the operator is the person reading this.

## What is actually wired

| Capability                 | State                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| Readiness endpoint         | **Live** — `/api/ready`, public, never touches the database                     |
| Database probe             | **Live** — `/api/monitoring/health`, public, runs `SELECT 1`                    |
| Health endpoints           | **Live** — `/api/health`, `/api/health/db`, `/api/health/email`, behind sign-in |
| Prometheus-format metrics  | **Live** — `/api/metrics`, hand-rolled, no `prom-client` dependency             |
| Structured JSON logging    | **Live** — `lib/utils/logger.ts`                                                |
| In-process error tracking  | **Live** — `lib/monitoring/error-tracker.ts`, readable in development           |
| Alerting / paging          | **Not wired.** Nothing sends a notification when a check fails                  |
| Sentry / Grafana / Datadog | **Not wired.** No SDK is installed                                              |

Nothing polls these endpoints on your behalf. If you want to be told when the instance is down,
point an external uptime checker at one of the two probes that need no session:

- **`/api/ready`** answers `200` as soon as the process serves requests and never touches the
  database, which is why the Docker `HEALTHCHECK` uses it. It tells you the app is up, not that
  the database works.
- **`/api/monitoring/health`** also runs `SELECT 1` through Prisma. It answers `200` with
  `"database": "healthy"`, or `503` with `"status": "unhealthy"` when the query fails; CI's smoke
  test uses it for exactly that. In production the error detail is reduced to `"database error"`.

The health endpoints below report more, but need a signed-in session.

## Health endpoints

`/api/health` answers only a signed-in owner (`401`/`403` otherwise). `/api/health/db` and
`/api/health/email` are behind the proxy's session check like every non-public route. Check them
from a signed-in browser, or open **`/admin`**, which reports the database, the schema and
whether email is configured.

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
# HELP email_sent_total Automated reminder emails sent successfully
# TYPE email_sent_total counter
email_sent_total 12

# HELP process_uptime_seconds Process uptime in seconds
# TYPE process_uptime_seconds gauge
process_uptime_seconds 3600.5
```

Exposed series: `email_sent_total`, `email_failed_total`, `process_uptime_seconds` and
`metrics_reset_timestamp_seconds`. Add `Accept: application/json` for the same numbers as JSON.

Three properties worth knowing before you build anything on it:

- **Scraping it takes `METRICS_TOKEN`.** The proxy lets `/api/metrics` through without a session.
  In production the route then answers `403` unless the request carries
  `Authorization: Bearer $METRICS_TOKEN` — always `403` while `METRICS_TOKEN` is unset. In
  development it answers anyone. The token opens nothing else, so a scrape config holds read access
  to counters and no more.
- **The email counters count only the automated reminder e-mails**
  (`lib/services/notifications/reminder-email.ts`), not every message the app sends.
- **The counters live in process.** They reset on every restart and every redeploy, which is
  what `metrics_reset_timestamp_seconds` is for. Treat them as rates since last boot, not as
  lifetime totals.

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
docker compose logs -f situs-prod | jq 'select(.level == "error")'
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

- **After a deploy** — `curl -fsS https://your-instance/api/ready` should succeed, and `/admin`
  (signed in) should show the database and schema as healthy.
- **When something looks wrong** — `/admin` or `/api/health/db` first (is the database the
  cause?), then the error-level log lines above.
- **Backups** — health checks say nothing about your data surviving; see
  [DATABASE_STRATEGY.md](DATABASE_STRATEGY.md#backup--recovery). A health endpoint returning `ok`
  on an instance with no backups is exactly as green as one with them.

## What this deliberately leaves out

Alerting rules, dashboard templates, severity ladders and escalation paths were removed rather
than rewritten. They described a team, a rotation and a toolchain that this deployment does not
have, and a runbook for infrastructure nobody runs is worse than no runbook: it reads as though
someone is watching.

If Situs later runs somewhere that needs them, add them alongside the integration that makes
them real — a scrape config next to a Prometheus instance that exists, an alert rule next to the
receiver that fires it.
