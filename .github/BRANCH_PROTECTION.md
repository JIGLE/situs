# Branch Protection Rules

This file covers **protection mechanics** — the required-check contexts, how to apply the
configuration, and the release workflow's dependency on `enforce_admins: false`.

The branching model and naming convention live in
[`docs/REPOSITORY_PROCEDURES.md`](../docs/REPOSITORY_PROCEDURES.md), which is authoritative.
They used to be described here, in `CONTRIBUTING.md` and in `CLAUDE.md` simultaneously, in three
mutually inconsistent versions. `scripts/check-branch-name.js` enforces the convention.

---

## Apply Branch Protection (run once after repo setup)

The `branch-protection-config.json` file in this directory contains the ready-to-apply configuration.

```bash
# Requires: gh auth login with admin scope on the repo
gh api repos/JIGLE/situs/branches/main/protection \
  --method PUT \
  --input .github/branch-protection-config.json
```

### Required status checks configured

| Check name                   | Workflow                             |
| ---------------------------- | ------------------------------------ |
| `verify / Lint & Type Check` | `ci.yml` (via `reusable-verify.yml`) |
| `verify / Unit Tests`        | `ci.yml` (via `reusable-verify.yml`) |
| `Build validation`           | `ci.yml`                             |
| `Dependency Security Scan`   | `security-scan.yml`                  |

`ci.yml`'s `verify:` job calls `reusable-verify.yml` via `uses:`, and GitHub Actions
automatically prefixes reusable-workflow job names with the calling job's name — the actual
posted check names are `verify / Lint & Type Check` and `verify / Unit Tests`, **not** the bare
`Lint & Type Check` / `Unit Tests` this file previously listed. That mismatch meant the two most
important gates never matched their required-check names and sat "Expected — waiting..."
forever, silently relying on an admin merge (`enforce_admins: false`) to get anything through
(discovered on PR #301). If `reusable-verify.yml`'s job `name:` fields or `ci.yml`'s calling job
id (`verify`) ever change, update the contexts below to match — do not rename either without
updating this table and `branch-protection-config.json` together.

### Notes on the release workflow

`release.yml` creates a `release/vX.Y.Z` branch and opens a PR to `main`. It then calls
`gh pr merge --squash` to merge it. Since the workflow token has `contents: write` and
`pull-requests: write`, this works when `enforce_admins: false` (the current config).

If you later enable `enforce_admins: true`, the release workflow will need either:

- A **fine-grained PAT** (stored as `RELEASE_TOKEN` secret) with bypass rights, or
- A **GitHub App** with branch protection bypass configured.

To verify current protection status:

```bash
gh api repos/JIGLE/situs/branches/main/protection | jq '{
  required_reviews: .required_pull_request_reviews.required_approving_review_count,
  required_checks: [.required_status_checks.contexts[]],
  enforce_admins: .enforce_admins.enabled,
  force_push_allowed: .allow_force_pushes.enabled
}'
```

---

## Verify protection is active

```bash
# Should return 403 when trying to push directly to main
git push origin main --dry-run
```
