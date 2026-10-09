# Branch Protection Rules

This file covers **protection mechanics**: the ruleset that guards `main`, the required-check
contexts, how to apply it, and why release PRs need the admin bypass.

The branching model and naming convention live in
[`docs/REPOSITORY_PROCEDURES.md`](../docs/REPOSITORY_PROCEDURES.md), which is authoritative.
`scripts/check-branch-name.js` enforces the convention.

`main` is protected by a **repository ruleset** (Settings → Rules → Rulesets → "main protection"),
not by the classic branch-protection API. `.github/main-ruleset.json` is that ruleset as the
API returns it; the live one is the source of truth.

---

## What the ruleset does

| Rule                     | Effect                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Restrict deletions       | `main` cannot be deleted.                                                                     |
| Block force pushes       | History on `main` is never rewritten.                                                         |
| Require status checks    | The four checks below must pass before a pull request can merge.                              |
| Bypass: Repository admin | An admin can merge a pull request whose checks are missing or red ("for pull requests only"). |

There is no required-review rule: this is one owner's instance, and the owner merges. "Require
branches to be up to date" is off, so a green pull request is not re-run each time `main` moves.

### Required status checks

| Check name                   | Workflow                             |
| ---------------------------- | ------------------------------------ |
| `verify / Lint & Type Check` | `ci.yml` (via `reusable-verify.yml`) |
| `verify / Unit Tests`        | `ci.yml` (via `reusable-verify.yml`) |
| `Build validation`           | `ci.yml`                             |
| `Dependency Security Scan`   | `security-scan.yml`                  |

`ci.yml`'s `verify:` job calls `reusable-verify.yml` via `uses:`, and GitHub Actions
automatically prefixes reusable-workflow job names with the calling job's name, so the posted
check names are `verify / Lint & Type Check` and `verify / Unit Tests`, **not** the bare
`Lint & Type Check` / `Unit Tests`. A required check matches by exact string: a bare name sits
"Expected — waiting..." forever (found on PR #301, when only an admin merge got anything
through). If `reusable-verify.yml`'s job `name:` fields or `ci.yml`'s calling job id (`verify`)
ever change, change the contexts in `.github/main-ruleset.json` and in the ruleset itself in the
same commit.

---

## The release workflow and the bypass

`release.yml` pushes `release/vX.Y.Z` and opens a version-bump pull request with the default
`GITHUB_TOKEN`. GitHub starts no workflow from an event that token creates, so **that pull
request's checks never report**, and a required check that never reports blocks the merge. The
workflow's `gh pr merge --auto` therefore waits for ever, and the owner merges the pull request
by hand with the admin bypass (the owner is a Repository admin, and the bypass is limited to pull
requests, so direct pushes to `main` stay refused).

Setting the `RELEASE_TOKEN` secret (a fine-grained PAT with Contents and Pull requests write)
changes this: the pull request is then opened as a user, its checks run, and it merges without
the bypass. It also matters for the deploy: GitHub starts no workflow from a tag pushed with
`GITHUB_TOKEN`, so without it the release tag does not start `deploy-ghcr.yml` and the deploy is
dispatched against the tag ref
([`docs/REPOSITORY_PROCEDURES.md`](../docs/REPOSITORY_PROCEDURES.md) §5).

---

## Apply or change the ruleset

Use the settings page (Settings → Rules → Rulesets → "main protection"). With a token that has
repository-admin rights, the file in this directory applies through the API:

```bash
gh api -X PUT repos/JIGLE/situs/rulesets/15974461 --input .github/main-ruleset.json
```

## Verify it is active

```bash
gh api repos/JIGLE/situs/rulesets/15974461 | jq '{
  enforcement,
  bypass: .bypass_actors,
  rules: [.rules[] | {type, checks: [.parameters.required_status_checks[]?.context]}]
}'
```

`git push --dry-run` does not send the ref update, so it never reaches the server-side check and
cannot show whether protection is on. The classic endpoint,
`repos/JIGLE/situs/branches/main/protection`, answers 404 here because no classic rule exists.
