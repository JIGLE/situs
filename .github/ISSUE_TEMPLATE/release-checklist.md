---
name: Release checklist
about: Create a new release with a short checklist to ensure stabilty and reproducibility
---

# Release checklist

The release is driven by `release.yml`, which does the version bump and creates the tag itself.
Do **not** bump the version by hand or push the tag by hand — see the note at the bottom for why.

- [ ] `Actions → Release → Run workflow`, choosing `patch` / `minor` / `major`.
      This opens a version-bump PR from a `release/vX.Y.Z` branch.
- [ ] Review the bump PR: `package.json`, `package-lock.json`, `item.yaml`, `docker-compose.yml`
      should all carry the new version, and CI should be green on it.
- [ ] Merge the bump PR.
- [ ] Confirm `release.yml`'s **Publish Release** job created tag `vX.Y.Z` and the GitHub Release.
- [ ] Confirm **Deploy to GHCR** ran for the tag and succeeded — the Trivy scan blocks
      publication on a CRITICAL finding in the base image, which is a genuine stopper. The tag
      starts it on its own only when the `RELEASE_TOKEN` secret is set; otherwise run it by hand:
      `Actions → Deploy to GHCR → Run workflow`, choosing tag `vX.Y.Z`.
- [ ] Verify `ghcr.io/jigle/situs:X.Y.Z` exists, and that `:latest` now points at it.
- [ ] Deploy to a staging environment and smoke-test sign-in and the rent → receipt flow.
- [ ] Check `/admin` on the deployed instance: schema in sync, no unexpected errors.

Notes:

- **Why the tag is not pushed by hand.** `release.yml`'s `publish` job runs on every push to
  `main` and creates the tag when `package.json` carries a version that has no tag yet. Pushing a
  tag manually races that: the tag ends up on a different commit from the one the version bump
  landed on, and `deploy-ghcr.yml` then builds `:X.Y.Z` from source the tag does not point at.
  That has happened — `deploy-ghcr.yml` records `:1.24.0` being built from `43997fd` while the git
  tag pointed elsewhere, with `:latest` moving onto it at the same time.
- **To test a build before releasing**, use the development channel instead of a dry run:
  merge to `main` and pull `ghcr.io/jigle/situs:main`, or pin the exact
  `ghcr.io/jigle/situs:sha-<short>`. Neither can claim `:latest`. See `docs/truenas.md`.
- `Actions → Deploy to GHCR` also accepts `dry_run=true` to prove an image builds without
  publishing anything.
