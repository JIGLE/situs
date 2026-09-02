# TrueNAS SCALE Deployment Guide

Situs runs on TrueNAS SCALE as a **Custom App** (Docker). This is the only supported deployment
path.

> **No Kubernetes or Helm.** TrueNAS SCALE replaced its Kubernetes app engine with Docker in
> Electric Eel (24.10). The Helm chart and `k8s/` manifests this repo used to carry have been
> removed rather than left to rot — they could not run on a current TrueNAS and misled anyone
> reading them. If you are on 24.04 or earlier, use an older tag of this repository.

## Quick install

1. **Apps → Discover Apps → Custom App**
2. Image: `ghcr.io/jigle/situs:latest` (pin a version tag in production — see [Which tag](#which-tag))
3. Port: container `3000` → whichever host port you want
4. Storage: mount a host path at **`/app/data`**
5. Add the environment variables below
6. Install

The container initialises its own database on first start — `prestart` runs `prisma db push` when
the SQLite file has no tables, and adds any missing columns on every subsequent start. No init job,
no manual step.

## Which tag

Three names, written by different things. Picking the wrong one is the most common way to end up
running code you did not expect.

| Tag                  | Written by                         | Use it for               |
| -------------------- | ---------------------------------- | ------------------------ |
| `:latest`, `:1.25.0` | a release tag push only            | production               |
| `:main`              | every merge to `main`              | testing the newest code  |
| `:sha-<short>`       | every merge, and manual dispatches | pinning one exact commit |

**Only a release can claim `:latest` or a bare version number.** A build from `main` or a manual
dispatch is never allowed to, which is what stops a test image quietly becoming production.

**An image exists only if a workflow ran.** Naming a tag here does not build it — if the tag was
never published, the pull fails and TrueNAS keeps serving whatever it already had, which looks
exactly like a deploy that did nothing. Check `Actions → Deploy to GHCR` if in doubt, and
`https://<your-host>/api/info` to see the version and commit baked into the image that is
actually running.

> `/api/info` reported `dev` / `unknown` on every correctly built image until the runner stage
> carried the build args into the process — the ARGs reached the image labels but not the running
> app. It reports honestly from that build onward. Two checks that do not depend on it:
> `https://<your-host>/version.json`, a static file written at build time, and
> `docker inspect ghcr.io/jigle/situs:main --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.
> A locally built image without `--build-arg` reports `unknown` for all three, which is correct.

> **Set the image pull policy to `Always` if you use `:main`.** It is a moving pointer, so with
> `IfNotPresent` the node keeps serving the cached layer and the tag appears frozen. Pinning
> `:sha-<short>` avoids the question entirely, because the name changes on every deploy.

## Storage

Create a dataset (for example `apps/situs/data`) and mount it at `/app/data`.

Set ownership to uid/gid **1001:1001** — the container drops to a non-root `nextjs` user, and it
cannot write to a dataset owned by anyone else. A container that starts and then fails on the first
write is almost always this.

## Environment variables

### Required

| Variable             | Example                       | Notes                                                                        |
| -------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `NEXTAUTH_URL`       | `https://situs.example.com`   | Full external URL, no trailing slash. Must match how users reach the app.    |
| `NEXTAUTH_SECRET`    | `openssl rand -base64 32`     | Minimum 32 characters. Signs sessions and tenant portal tokens.              |
| `DATABASE_URL`       | `file:/app/data/situs.sqlite` | Path **inside** the container, on the mounted dataset.                       |
| `PII_ENCRYPTION_KEY` | `openssl rand -hex 32`        | Exactly 64 hex chars. **The app refuses to start in production without it.** |

`PII_ENCRYPTION_KEY` encrypts IBAN, tax ID (NIF) and phone at rest. Without it those fields were
previously written in plaintext with no warning, which is why the app now exits instead. To run
without encryption anyway — a throwaway staging box — set `ALLOW_UNENCRYPTED_PII=true` and accept
a loud warning on every start.

If you set the key on a deployment that already has data, run
`node scripts/backfill-pii-encryption.js` to encrypt the rows written before it existed.

### Recommended

| Variable              | Default | Notes                                                                        |
| --------------------- | ------- | ---------------------------------------------------------------------------- |
| `TRUSTED_PROXY_COUNT` | `1`     | Number of proxies in front (Cloudflare tunnel / reverse proxy counts as one) |

This decides which `X-Forwarded-For` entry the rate limiter trusts. Leave it at `1` behind a single
tunnel or reverse proxy. Set it to `0` only if the container is reachable directly, in which case
the header is ignored entirely. Getting it wrong lets a caller pick their own rate-limit bucket.

### Optional

| Variable                                    | Notes                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `ENABLE_DEMO_LOGIN`                         | `true` enables demo credentials that grant **ADMIN**. Leave unset in production. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Enables Google sign-in — see below                                               |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`       | Email delivery over SMTP (Brevo, Resend, SES — any provider)                     |
| `STRIPE_SECRET_KEY`, `ENABLE_STRIPE`        | Card / SEPA payments                                                             |
| `AUTO_DB_INIT`, `AUTO_DB_SCHEMA_SYNC`       | Both default `true`; set `false` to manage schema yourself                       |

> `NEXT_PUBLIC_ENABLE_DEMO_LOGIN` no longer exists. The sign-in form now resolves demo
> availability from `ENABLE_DEMO_LOGIN` on the server per request, so one variable controls both
> the form and the provider. Remove it if it is still set.

## Bank movements

Two ways in, and the pipeline downstream is identical either way — an imported movement gets the
same fingerprint dedupe, reconciliation rules, confidence scoring and 0.85 auto-allocation
threshold a synced one does.

**CSV import** works with no setup at all: Finance › Bank Movements, upload a statement exported
from your bank.

**A live connection** uses [Enable Banking](https://enablebanking.com/docs/), who hold the AISP
licence — so this instance needs no PSD2 licence and no eIDAS certificate of its own. Their
**restricted production** mode is free and limited to accounts you whitelist as yours, which is
exactly the self-hosted case; their paid tiers are for products aggregating other people's accounts.

1. Register a **Production** application in their Control Panel, and whitelist your own accounts
   to activate restricted mode. This is the one that connects a real bank.

   > **The two application types do different jobs, and the difference is not obvious.** A
   > _Sandbox_ application activates instantly, which makes it look like the sensible first step —
   > this guide said so until someone followed the advice and reached a dead end. Sandbox does not
   > reach real banks at all: it reaches a **Mock ASPSP**, a synthetic bank whose accounts and
   > transactions you define yourself under the Control Panel's _Mock ASPSP_ tab. Since the connect
   > picker here offers only Portugal and Spain, a sandbox application leaves it empty.
   >
   > That makes sandbox useless for connecting your bank and genuinely useful for something else:
   > it is the only safe way to exercise the transaction mapping, because you control exactly what
   > the payload contains. See _Recording the transaction shape_ below.

2. Save the RSA private key it generates. You are offered it once.
3. Add this exact URL to the application's allowed redirect URLs:
   `https://<your-host>/api/bank/connections/callback`. It must match `NEXTAUTH_URL`, because
   Enable Banking validates the redirect against that list rather than accepting whatever is sent.
4. Set `ENABLE_BANKING_APPLICATION_ID`, and give the app the key **as a file** (see below), then
   restart.
5. Settings › Integrations → **Connect a bank**. You authorise at your own bank; Situs never sees
   your banking password.

### The private key goes in a file, not an environment variable

TrueNAS caps an app-config value at **1,000 characters**. An RSA-2048 PEM is around 1,700, and
base64-encoding it makes it ~2,272 — so there is no encoding that fits. Mount it instead, which is
what you would want anyway: an environment variable holding a private key is readable from
`/proc/<pid>/environ`, shows up in process listings and crash dumps, and is echoed by any diagnostic
that prints the environment. A file with `0400` is none of those.

The walkthrough below is for **TrueNAS 24.10 and newer** (Electric Eel, Fangtooth, Goldeye), where
apps run on Docker. Substitute your own pool name wherever you see `POOL` — everything else is
literal and can be copied as-is. Nothing here needs a terminal on your own machine; the TrueNAS web
UI has a shell built in.

#### 1. Put the key on the NAS

**System Settings → Shell** in the TrueNAS web UI. Become root first — the app datasets are
root-owned, so `truenas_admin` gets "permission denied" on every step below without this:

```bash
sudo -i
```

> **Do not reach for `sudo cat > file` instead.** It fails with the same "permission denied", and
> confusingly so: the `>` redirect is performed by your own shell _before_ `sudo` runs, so the file
> is still created as `truenas_admin` — `sudo` only elevates `cat`, which is not the part that
> needs it. If you would rather not hold a root shell, the working form is
> `sudo tee <path> > /dev/null`, which takes the same paste on stdin. `sudo -i` is simpler here,
> because the `chown`, `chmod` and `ls` steps all need root too. Type `exit` when you are done.

Now create the folder:

```bash
mkdir -p /mnt/POOL/situs/secrets
```

Then start writing the file, paste the key, and finish with **Enter** followed by **Ctrl+D**:

```bash
cat > /mnt/POOL/situs/secrets/app.pem
```

Paste the entire `.pem`, including the `-----BEGIN` and `-----END` marker lines at the top and
bottom of it. Open it in Notepad or TextEdit first if you need to; it is a text file.

Check the paste survived, because this is where it usually goes wrong:

```bash
head -1 /mnt/POOL/situs/secrets/app.pem
wc -l /mnt/POOL/situs/secrets/app.pem
```

The first command must print a line beginning `-----BEGIN`. The second must print more than one
line — around 28 for a 2048-bit key. **A count of 1 means the line breaks were lost in the paste**,
which produces `DECODER routines::unsupported` later; delete the file and paste again.

#### 2. Make it readable by the app, and by nothing else

```bash
chown 1001:1001 /mnt/POOL/situs/secrets/app.pem
chmod 400 /mnt/POOL/situs/secrets/app.pem
ls -l /mnt/POOL/situs/secrets/app.pem
```

Then check the whole path, not only the file. Every parent directory has to be traversable by uid
1001 as well, and one that is not presents exactly like a wrong path:

```bash
namei -l /mnt/POOL/situs/secrets/app.pem
```

Every line needs an `x` for others. If one shows `drwx------` and root ownership, `chmod o+x` that
directory.

Expect `-r-------- 1 1001 1001` from `ls`. The **numbers** are what matter, not a name: the container runs as
uid/gid 1001, and TrueNAS may show a different (or no) username for that id on the host side. If
`ls` prints a name instead of `1001`, that is fine as long as `chown` reported no error.

> If your pool uses NFSv4 ACLs, `ls -l` may show a trailing `+` and `chmod` may not stick. Check
> with `getfacl`, and prefer a plain directory under an existing dataset over creating a new
> dataset with a share preset.

#### 3. Mount the folder into the app

**Apps → your Situs app → Edit → Storage → Add**, then:

| Field      | Value                     |
| ---------- | ------------------------- |
| Type       | **Host Path**             |
| Host Path  | `/mnt/POOL/situs/secrets` |
| Mount Path | `/app/secrets`            |
| Read Only  | **on**                    |

Mount the **folder**, not the file — mounting a single file works less reliably across Docker
versions, and the folder costs nothing. The exact field labels move slightly between point releases
(you may see "Host Path Volumes", or a separate "Mount Path"/"Container Path" wording); look for the
pair that asks where it is _on the NAS_ and where it should appear _inside the app_.

#### 4. Set the two variables

In the same edit form, under environment variables:

| Name                              | Value                                     |
| --------------------------------- | ----------------------------------------- |
| `ENABLE_BANKING_APPLICATION_ID`   | the application id from the Control Panel |
| `ENABLE_BANKING_PRIVATE_KEY_FILE` | `/app/secrets/app.pem`                    |

**Delete `ENABLE_BANKING_PRIVATE_KEY` if it is still there.** The file wins when both are set, so
nothing breaks immediately — which is the problem: a stale inline value sits there until it
surfaces as an unexplained 401 weeks later.

#### 5. Save

Saving redeploys the app, so no separate restart is needed this time.

Later, if you ever replace the _contents_ of `app.pem` at the same path, **restart the app by hand**.
The key is read once and cached for the life of the process, so the old one keeps being used until
something restarts it.

#### 6. Check that it worked

Open **Settings › Integrations** in Situs:

- a **Connect a bank** button — the key was found and read. Done.
- a box headed **"Bank connection not configured"** — the app did not get both values. A variable is
  unset or misspelled, or the app has not restarted.

**`/admin` is not the check here.** It will still say _"Manual / CSV import only — no bank is
connected on this account"_, and that is correct: it reports which banks you have connected, not
whether credentials are present. It only changes after you complete step 7 and connect one.

#### 7. Register the redirect URL, then connect

Back in Enable Banking's Control Panel, the application's allowed redirect URLs must contain your
`NEXTAUTH_URL` followed by `/api/bank/connections/callback` — for example
`https://situs.example.org/api/bank/connections/callback`. It is compared exactly, and a mismatch is
refused at their end after you have already authenticated at your bank, which is a confusing place
to discover it.

Then **Settings › Integrations → Connect a bank**. You authorise at your own bank; Situs never sees
your banking password.

#### If something is wrong

| What you see                                      | What it means                                                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| The bank section fails to load, or shows an error | The path is wrong or unreadable. **Apps → the app → Logs**: the message names the path.                   |
| The file looks right but is still unreadable      | A parent directory is not traversable by uid 1001. `namei -l <path>` shows which one.                     |
| The picker opens but lists no banks               | A Sandbox application, or a Production one whose accounts are not whitelisted yet. The picker says which. |
| "Bank connection not configured" persists         | A variable is unset or misspelled, or the app did not restart.                                            |
| `DECODER routines::unsupported`                   | The PEM lost its line breaks. Redo step 1 and check `wc -l`.                                              |
| 401 from Enable Banking                           | A leftover `ENABLE_BANKING_PRIVATE_KEY`, or the key does not belong to that application.                  |
| The bank refuses the redirect                     | Step 7 — the registered URL does not match `NEXTAUTH_URL` exactly.                                        |

An unreadable path is treated as a **configuration error**, not as "no bank provider configured" —
a misconfigured instance and a deliberately CSV-only one must not look the same. The message names
the path but not the key, and it reaches the container log rather than the browser, because error
detail is deliberately not returned to clients.

To confirm the credentials and record what the API actually returns:

```bash
ENABLE_BANKING_APPLICATION_ID=… ENABLE_BANKING_PRIVATE_KEY_FILE=/app/secrets/app.pem \
  node scripts/enablebanking-check.mjs --country PT
```

It redacts IBANs, names, amounts and tokens before printing, so the output is safe to share. The
transaction shape it records is the one part of the adapter not yet verified against a real
response.

### Recording the transaction shape

`mapTransaction` in `lib/services/bank/providers/enablebanking.ts` decides whether a movement is
money in or money out and which party is the counterparty. It was written from Enable Banking's API
reference rather than from a recorded response, and it handles both sign conventions defensively
because which one an ASPSP uses is not known. **Handled defensively is not verified**: a sign error
there mis-matches rent silently instead of failing, which is worse than an outage because nobody
goes looking.

A Sandbox application is how to settle it without involving a real account:

1. Control Panel → **Mock ASPSP** → add an account, or use the one already there.
2. **Balances & Transactions** on that account → add at least one credit and one debit, with a
   reference resembling a real rent transfer.
3. Connect that mock bank from Settings › Integrations using the sandbox credentials.
4. `node scripts/enablebanking-check.mjs --session <session_id>`.

The output names the fields and their formats while redacting every value, so it is safe to paste
into an issue. Replace the assumed fixtures in `enablebanking.test.ts` with what it records, and
delete the comments marking them as assumptions.

### What this instance actually needs

Worth knowing before signing up for anything: almost every external service is optional, and a
self-hosted instance collecting rent by bank transfer needs none of them.

| Service        | Required? | What it is for                                                                                                                               |
| -------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable Banking | optional  | live bank movements. Unset, CSV import covers it                                                                                             |
| Stripe         | optional  | collecting rent by card/SEPA, and subscription billing. Unset, the payment routes answer "not configured" and plan limits are never enforced |
| SMTP           | optional  | outbound email, any provider. Unset, email is simply not sent                                                                                |
| Redis          | optional  | caching                                                                                                                                      |
| Google OAuth   | optional  | sign-in. Credentials sign-in works without it                                                                                                |

Required in every case: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, and
`PII_ENCRYPTION_KEY` in production.

Reads are capped per connection per day and the app enforces that budget itself, showing what is
left, so "Sync now" refuses rather than burning the allowance.

For the daily automatic sync, set `CRON_SECRET` and point a scheduler at the endpoint once a day:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-host>/api/cron/bank-sync
```

The same secret gates `/api/cron/notifications` and `/api/cron/data-retention`; all three return
503 while it is unset, so nothing runs on a schedule until you set it.

Consents expire — 90 days by default, and a bank can revoke one sooner. When that happens the
connection is marked expired, syncing stops rather than quietly returning nothing, and both
Settings › Integrations and `/admin` say so with a **Reconnect** action.

To verify the flow before pointing it at a real bank, connect to `SANDBOXFINANCE_SFIN0000` from
the picker: it is a real API call against test data, not a mock.

## Google OAuth

In [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials), add an
authorised redirect URI:

```
https://<your-domain>/api/auth/callback/google
```

It must match `NEXTAUTH_URL` exactly. When changing domains, add the new URI **before** cutting
over and remove the old one afterwards — otherwise sign-in fails with `redirect_uri_mismatch`.

## Publishing an image

Nothing reaches GHCR just because code landed on `main`. Two paths put an image there:

**A release (what production should run).** Actions → **Release** → Run workflow → pick
`patch`/`minor`/`major`. That opens a `release/vX.Y.Z` PR with the version bumps; merging it to
`main` makes the workflow create the tag and the GitHub Release, and the tag push is what triggers
**Deploy to GHCR**. So it is dispatch → merge → wait, not one button.

**A merge to `main` (the development channel).** Every merge builds automatically and publishes
`:main` and `:sha-<short>`. Nothing to dispatch — this is the normal way to test merged code.

**A one-off build (for a branch that has not been merged).** Actions → **Deploy to GHCR** → Run
workflow, choosing the branch and optionally a `version` string containing a hyphen, e.g.
`1.25.0-rc1`. A bare number like `1.25.0` is refused and falls back to `sha-<short>`, because bare
version numbers belong to releases. `dry_run: true` proves the image builds without publishing.

> This warning used to read "a one-off build still writes `:latest`". **That is no longer true**
> and was left here after the workflow was hardened. Only a tag push can write `:latest` or a bare
> version now — see [Which tag](#which-tag) — so testing a branch cannot move production. The
> stale warning is called out rather than quietly deleted because it discouraged using the
> dispatch path at all, which is the safe one.

## Updating

1. Check <https://github.com/JIGLE/situs/releases>
2. Change the image tag in the app's settings
3. Redeploy — the container applies any additive schema changes on start
4. Verify: `curl https://<your-domain>/version.json`

TrueNAS does not detect updates for a Custom App; there is no catalog metadata to compare against.
Either check releases manually or run a container auto-updater alongside it.

## Troubleshooting

**Container starts then exits immediately.** Check the logs for the `PII_ENCRYPTION_KEY` message —
a missing key is a deliberate hard stop, not a crash.

**All API routes return 500 "Authentication failed".** The database has no tables. Confirm the
`/app/data` mount is writable by 1001:1001, then restart so `prestart` can run, or initialise
manually:

```bash
# From the TrueNAS shell, against the running container
docker exec -it <container> npx prisma db push --schema=prisma/schema.prisma
```

**App reports healthy, sign-in works, every data route 500s — and the mounted dataset is empty.**
The database was never created, because the host directory is not writable by the container. The
container runs as uid/gid **1001:1001**; a freshly created dataset is typically owned by root with
mode 755, which gives 1001 read and execute but not write. From the TrueNAS shell:

```bash
sudo ls -lan /mnt/<pool>/<your-dataset>      # owner 0 0 = this is the problem
sudo chown -R 1001:1001 /mnt/<pool>/<your-dataset>
sudo chmod -R 770 /mnt/<pool>/<your-dataset>
```

Then restart. Note that after the `chown` your own shell user can no longer list the directory
without `sudo` — that is the change working, not a new fault.

Sign-in keeps working throughout because NextAuth uses JWT sessions and never reads the database,
which makes this look like a partial outage rather than a missing database. Images built after
2026-08-14 refuse to start in this state and print the `chown` above; older ones start anyway and
serve 500s. `PRESTART_FAIL_ON_SQLITE=false` restores the old behaviour if you need the app up
while you sort the mount out.

**Saving anything fails with a foreign-key or "record not found" error, right after the database
was first created.** The wording varies by screen — Prisma's `P2003` on `UserSettings.userId`, or
`P2025` on `User` — but they mean the same thing: the session names a user record that does not
exist.

**Sign out and sign in again.** That is the whole fix.

The cause is the order things happened in. Sessions are JWTs and the id inside one is written
once, at sign-in. If you signed in while `/app/data` was unwritable — before the `chown` above —
there was no database to provision the account into, so the token was issued carrying Google's
account id instead of a real `User.id`. The database exists now, but the token still points at
something that was never in it, and nothing re-resolves it for the session's 24-hour life.

Images built after 2026-08-14 close both halves of this: sign-in fails outright rather than
handing out a session that cannot write, and an existing token that names no user is repaired
from its email address on the next request. On those images the situation clears itself. **`/admin`**
reports it either way, under **Signed-in account**.

**Sign-in works but every data route returns 500 "Internal server error".** Different problem: the
tables exist (NextAuth is reading them) and it is the application models that fail. Almost always
schema drift — the image expects a column the database does not have, and one missing column takes
down every query for that model, so unrelated pages break together.

Open **`/admin`** first. It runs outside the normal data loading precisely so it still works when
this happens, and it names the missing columns with the command that fixes them. If the deployed
image is too old to have that page, the container log carries the same information:

```
The column `main.<table>.<column>` does not exist in the current database
```

The fix is a restart with `AUTO_DB_SCHEMA_SYNC` at its default (`true`), which applies additive
changes on start. If it is set to `false`, that is the cause.

A second, rarer cause looks identical from the browser: `PII_ENCRYPTION_KEY` was changed on an
instance that already had encrypted rows. That only breaks models with protected fields — tenants,
owners, payment methods, rent receipts, NRUA registrations — so if properties and buildings load
fine and those do not, suspect the key rather than the schema. Affected fields now read
`[ENCRYPTED]` instead of failing the request, and the reason is logged. Recover with
`node scripts/backfill-pii-encryption.js`, or restore the original key.

**Sign-in redirects in a loop or fails after a domain change.** `NEXTAUTH_URL` does not match the
URL in the browser, or the Google redirect URI was not updated.

**Rate limiting seems ineffective, or legitimate traffic gets 429s.** `TRUSTED_PROXY_COUNT` does
not match your actual proxy depth.

See [troubleshooting.md](troubleshooting.md) for issues not specific to TrueNAS.

## Removing

Apps → select the app → **Delete**. The dataset at `/app/data` survives unless you delete it
separately — which is also your backup, so take a snapshot before removing anything.
