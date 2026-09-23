Workflow naming convention

We use a simple convention to make workflow intent and scope clear from the filename.

Active workflows (`.github/workflows/`):

- `ci.yml` — Continuous integration: lint, type-check, unit tests, build, and smoke tests on
  every PR to `main` and every push to `main` (plus E2E smoke and the mobile audit on PRs, and
  the full Playwright suite via the `run-e2e` label or manual dispatch).
- `security-scan.yml` — Dependency audit, custom security scan, CodeQL, dependency review, and
  secret scanning. Runs on push/PR to `main`, nightly, and manual dispatch.
- `release.yml` — Two-phase release flow: `prepare` (manual dispatch) opens a version-bump PR;
  `publish` (push to `main`) tags and cuts the GitHub Release once a version bump lands, then
  verifies version integrity. On pushes that are not a version bump it reports release lag.
- `deploy-ghcr.yml` — Builds the Docker image, scans it with Trivy, and pushes to GHCR. The ref
  decides the tags: a `v*` tag writes `:<version>` and `:latest`, `main` writes `:main` and
  `:sha-<short>`, anything else `:sha-<short>`. It runs on a `v*` tag push, on a push to `main`
  that changes more than docs, on manual dispatch and on `repository_dispatch`;
  `docs/REPOSITORY_PROCEDURES.md` §5 has the release chain.
- `reusable-verify.yml` — **Reusable only** (`workflow_call`), never triggers on its own. Holds
  the lint/type-check/test trio called by `ci.yml`. Its job names (`Lint & Type Check`,
  `Unit Tests`) are required status checks in `.github/BRANCH_PROTECTION.md` — don't rename them
  without updating that doc and the branch protection config together.

Composite actions (`.github/actions/`):

- `start-app/` — Creates the SQLite schema, boots the standalone production server from the
  downloaded `.next` artifact, and waits for it. Used by all four `ci.yml` jobs that need a
  running app. Exists because the four copies it replaced each had to get two non-obvious
  details right — the schema step and the absolute `DATABASE_URL` — and a comment explaining
  them only helps where every caller inherits it.
- `resolve-scan-base/` — Works out a valid git base commit for the diff-scoped secret scans.

Superseded workflows are **deleted**, not parked; `git log --diff-filter=D -- .github/workflows`
finds them.

Guidelines:

- Keep filenames plain and descriptive (`<concern>.yml`); avoid vague qualifiers like
  "-consolidated" that only made sense relative to a past, smaller state.
- Before adding a new job that runs lint/type-check/test/build, check whether it belongs in
  `reusable-verify.yml` instead of a third copy. Before adding a job that boots the app, use
  `.github/actions/start-app`.
- Install with a bare `npm ci`. It used to be `npm ci || (npm install --package-lock-only …)`,
  which silently regenerated the lockfile on a mismatch and then tested a dependency tree
  nobody had reviewed — a green run that proved nothing about what ships.
- Pin third-party actions to full commit SHAs. `node scripts/pin-actions.mjs` rewrites them and
  `--check` reports what is still on a mutable tag; actions under `actions/` and `github/` are
  left on tags deliberately.
- Set `cancel-in-progress` to `${{ github.event_name == 'pull_request' }}`, not `true`.
  Cancelling superseded PR runs is the point; cancelling a `main` run leaves a shippable commit
  unverified, which has already happened here (runs #540/#541).
- Add `workflow_dispatch` to workflows that would otherwise only run on push/schedule, so they
  can be manually re-triggered and tested without waiting for the next real trigger.
- A gate that cannot fail is not a gate. When a step writes a report another step judges,
  a missing report must fail — `exit 0` on "no report" is indistinguishable from "no findings",
  and both the mobile audit and the security scan shipped that bug.
- **A green `CodeQL Security Analysis` job does not mean code scanning passed.** Two different
  checks carry the CodeQL name and they answer different questions. The job in
  `security-scan.yml` reports whether the _analysis ran_; the separate `CodeQL` check (posted by
  GitHub Advanced Security, linking to `/<owner>/<repo>/runs/<id>` rather than
  `/actions/runs/...`) reports whether the analysis _found anything_. The second fails in a few
  seconds because it only reads the uploaded SARIF — fast, but not a no-op. Read its annotation
  before concluding anything about it: it names a file, a line and a rule. Twice now the short
  runtime has been misread as "it did nothing", once in a way that nearly argued for disabling
  code scanning to silence a true positive.
- **An npm alias is not a caller.** `scripts/` held nine checker scripts and CI's `run:` steps
  invoked two; the other seven had `package.json` aliases and nothing that depended on them, so
  they passed or failed into the void for months. One had been exiting 1 the whole time on false
  positives, and another's ratchet baseline had drifted 11 above its real count because nothing
  measured it. Gates now go in `npm run hygiene`, which `verify:ci` calls — one insertion point, so
  CI, agents and local runs all get them without knowing they exist.
- **Two scripts are deliberately not gates**, and wiring them would create exactly the false green
  this file warns about:
  - `scripts/check-hostport.js` skips unless `PRESTART_CHECK_HOSTPORT=true`. It is a prestart
    runtime check; in CI it would pass by skipping.
  - `scripts/i18n-leak-scan.mjs` takes path arguments and exits 2 with a usage message when given
    none. It is a dev tool, not a gate.
- Update this file whenever a workflow is added, renamed, or retired — it drifted out of sync
  with the actual `.github/workflows/` contents once already; don't let that happen again.
