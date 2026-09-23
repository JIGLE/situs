# Playwright E2E Tests

Playwright end-to-end tests live in this directory. The config is `../playwright.config.ts`; signed-in
session state is written to `../playwright/.auth/` at run time and is not committed.

## Prerequisites

```bash
# Install Playwright browsers (one time)
npx playwright install --with-deps chromium
```

## Running E2E Tests Locally

```bash
# Start dev server + run all tests
npm run test:e2e

# Run with UI mode (interactive)
npm run test:e2e:ui

# Run a specific test file
npx playwright test e2e/dashboard.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Run only Chromium
npx playwright test --project=chromium
```

## Test Configuration

The Playwright config is at `../playwright.config.ts`. Key settings:

| Setting     | Local          | CI             |
| ----------- | -------------- | -------------- |
| Retries     | 1              | 2              |
| Workers     | auto           | 1              |
| Trace       | on-first-retry | on-first-retry |
| Screenshots | on-failure     | on-failure     |

## Writing Tests

- Name test files `*.spec.ts`, in this directory.
- Use `auth.setup.ts` for shared authentication setup.
- Keep tests isolated: each test should set up its own data.
- Use `test.describe` to group related tests.

## Test Reports

After running, view the HTML report:

```bash
npx playwright show-report
```

Reports are saved to `../playwright-report/`.

## Debugging

```bash
# Run with inspector
npx playwright test --debug

# Run with trace viewer
npx playwright test --trace on
npx playwright show-trace trace.zip
```

## CI Behavior

`E2E Smoke` runs on every pull request. The full `e2e` job is opt-in — add the `run-e2e` label to
the pull request, or dispatch the CI workflow with `run_e2e=true`.
