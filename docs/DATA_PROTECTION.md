# Data protection

A record of processing activities in the shape Article 30 asks for, plus the security measures
behind it. Written from the code, and pointing at the code wherever a number would otherwise
rot in prose.

**Scope.** This describes a single self-hosted Situs instance. There is one account; the
operator is the controller and, in the ordinary case, also the only data subject with an
account. The people whose data is processed are mostly _other_ people — tenants, owners, and
the counterparties on bank movements — which is why this document exists at all.

**Status.** Kept current with the code. If something here disagrees with the code, the code is
right and this is a bug. `docs:check` enforces that this file stays reachable, and
`scripts/check-docs.js` carries retired-claim guards for the statements this replaced.

---

## 1. Controller and contact

|                         |                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Controller              | The operator of the instance                                                                                         |
| Data protection contact | `DATA_PROTECTION_EMAIL` (see `.env.example`), published on `/privacy`                                                |
| Supervisory authorities | CNPD (Portugal)                                                                                                      |
| DPO                     | Not appointed. Article 37 does not require one here: no large-scale monitoring, no large-scale special-category data |

No DPIA has been carried out. Article 35 triggers on large-scale or systematic processing;
a single landlord's own portfolio is neither. That judgement should be revisited if Situs is
ever offered to other people.

## 2. Processing activities

| Activity                            | Purpose                                                                         | Lawful basis                                         |
| ----------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Property, unit and building records | Managing the portfolio                                                          | Legitimate interest (Art. 6(1)(f))                   |
| Tenant and lease records            | Performing the tenancy agreement                                                | Contract (Art. 6(1)(b))                              |
| Rent ledger, receipts, allocations  | Recording rent due and paid                                                     | Contract; legal obligation for the fiscal parts      |
| Bank movement ingestion (PSD2)      | Reconciling rent against bank credits                                           | Consent, given at the bank under PSD2 (Art. 6(1)(a)) |
| Fiscal filing (AT rent receipts)    | Statutory rent-income reporting                                                 | Legal obligation (Art. 6(1)(c))                      |
| Transactional email                 | Rent reminders, lease-expiry alerts                                             | Contract; legitimate interest                        |
| Contract import (optional)          | Reading a signed contract into the lease, tenant and owner records it describes | Contract; legitimate interest                        |
| Audit log                           | Accountability (Art. 5(2)), fraud detection                                     | Legal obligation; legitimate interest                |

**No special-category data** (Art. 9) is processed by design. Nothing asks for health, beliefs,
biometrics or the rest. Free-text fields — a bank remittance line, a receipt note — could
contain anything a person typed, which is a reason to keep them no longer than needed rather
than a reason to treat the app as processing Article 9 data.

**No automated decision-making with legal effect** (Art. 22). Bank matching scores a movement
against a lease and, above 0.85, creates a draft receipt; below that a human decides. Nothing
terminates a tenancy or refuses anyone anything. A contract's reading is a proposal in the same
way: nothing it says is written until the owner has reviewed every field and confirmed.

## 3. Categories of data

Fields marked **encrypted** are AES-256-GCM at rest (`lib/utils/pii-encryption.ts`).

### Via the Prisma extension

`PII_FIELDS` declares what the extension encrypts on write and decrypts on read. It is applied
where the client is built (`lib/services/database/database.ts`), so the encryption is
transparent rather than per-call-site:

| Model         | Encrypted fields                   |
| ------------- | ---------------------------------- |
| `Owner`       | `taxIdentificationNumber`, `phone` |
| `Tenant`      | `phone`, `taxId`, `idDocument`     |
| `LeaseParty`  | `taxId`, `idDocument`              |
| `RentReceipt` | `landlordNif`, `tenantNif`         |

`LeaseParty` holds a lease's co-tenants and guarantors. The extension transforms only the fields
of the model a query names: a nested `create` or `include` passes through it untouched. So a
model in this table is written and read through its own delegate, as `LeaseParty` is
(`lib/services/database/lease-parties.ts`), never nested under another.

### Encrypted at the call site

Three fields are deliberately **not** in `PII_FIELDS`. For the two bank fields the distinction
is load-bearing: `/api/debug/db` reads through the extension, so adding `BankAccount.iban` to
that list would make the debug endpoint start returning it in plaintext. The contract is bytes
rather than text, and too large to decrypt on every lease read.

| Model             | Field              | Handling                                                                                                             |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `BankAccount`     | `iban`             | Encrypted in `lib/services/bank/consent.ts`, **never decrypted**. Matching uses `ibanHash`; display uses `ibanLast4` |
| `BankTransaction` | `counterpartyIban` | Encrypted in `lib/services/bank/import.ts`. Matching uses `counterpartyIbanHash`                                     |
| `Lease`           | `contractFile`     | The signed contract PDF. Encrypted and decrypted only in `app/api/leases/[id]/contract/route.ts` (`encryptFile`)     |

The contract names every party with their NIF, which is why it is encrypted like the columns
that hold those NIFs. Its route is the only reader: the Prisma client leaves the column out of
every other lease query (`omit` in `lib/services/database/database.ts`). A contract uploaded
before encryption still downloads, and `scripts/backfill-pii-encryption.js` encrypts it.

### Personal data held in plaintext

Recorded here deliberately rather than left implicit:

| Model                  | Field              | Why                                                                                                                                                         |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Tenant`, `Owner`      | `name`, `email`    | Needed for search, sorting and sending mail; encrypting would break every list view                                                                         |
| `LeaseParty`           | `name`             | Shown on the lease beside the main tenant; the NIF beside it is encrypted                                                                                   |
| `LeaseClause`          | `summary`, `quote` | What a contract import kept of a clause, in the contract's own words. Clauses on renewal, rent, termination and deposit rarely name anyone, but a quote can |
| `BankTransaction`      | `counterpartyName` | The matching engine reads it to score a movement against a lease                                                                                            |
| `BankTransaction`      | `reference`        | The remittance line. Read for reference-month parsing. **Free text: may contain anything the payer typed**                                                  |
| `BankAccount`          | `ibanLast4`        | Four digits, displayed so a human can tell two accounts apart                                                                                               |
| `Property`, `Building` | address fields     | Personal data where a tenant lives there; core to the product                                                                                               |
| `Document`             | receipt archives   | The PDF kept when a receipt is emitted: the tenant's name, the property's address and the amount, on disk                                                   |

`BankTransaction.rawData` preserves the imported row for re-matching, with the IBAN stripped
before it is written (`redactRowForStorage`, `lib/services/bank/csv.ts`). It previously stored
the row verbatim, which meant the IBAN was written encrypted into its own column and again in
clear here.

## 4. Recipients

A self-hosted instance shares data with a service only when that service is configured.

| Recipient      | Receives                                                                               | When                                                                     | Location      |
| -------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------- |
| Enable Banking | Bank authorisation; returns account and transaction data                               | Only where a bank is connected                                           | EEA           |
| Brevo          | Recipient address and message body of transactional mail we send                       | Only where email is configured                                           | France (EEA)  |
| Portuguese AT  | Rent receipt filings                                                                   | Only on submission                                                       | Portugal      |
| Anthropic      | A lease contract and AT's proof of its registration, to be read; returns what they say | Only when the owner imports a contract, where `ANTHROPIC_API_KEY` is set | United States |

**Enable Banking is the licensed AISP**, which is why the instance needs no PSD2 licence and no
eIDAS certificate. Access is read-only account information: account details and transactions.
There is no payment-initiation scope anywhere in the adapter, and adding one would be a
different regulatory undertaking.

**Third-country transfers.** One, made only where it is configured and only when it is used:
importing a lease from its contract sends the PDFs to Anthropic, in the United States
(`app/api/contracts/extract/route.ts`, `lib/services/contracts/claude-extractor.ts`). The
documents carry everything a contract does: every party's name and NIF, a foreign party's
document number, addresses, amounts and signatures.

- **Without `ANTHROPIC_API_KEY`, nothing can be sent.** The Leases screen shows no import, and the
  route answers 503 before it reads a byte.
- **With it, each transfer is the owner's deliberate act.** The sheet says where the PDFs go
  before the owner sends them. Each reading writes an `EXTRACT_LEASE_CONTRACT` audit row whatever
  its outcome, because the documents have left either way. Nothing else is written until the
  owner confirms, and the reading is not stored: what is kept is what the owner confirmed.
- **The transfer basis is the operator's to establish**, under the terms of the Anthropic account
  whose key the instance is given: its data processing terms and the transfer mechanism they rely
  on. The app cannot see those terms.

Nothing else leaves the EEA under the default configuration: Enable Banking and Brevo both
operate there. Mail moved from SendGrid to Brevo partly for this reason, since SendGrid's region
depended on the account. That holds only for the default. The transport is plain SMTP, so an
operator who points `SMTP_HOST` at a non-EEA provider adds a transfer of their own to answer for.

## 5. Retention

Derived from `RETENTION_DAYS` in `lib/services/data-retention.ts` rather than restated, so the
schedule cannot drift from the code that applies it.

| Data                        | Period   | Note                                               |
| --------------------------- | -------- | -------------------------------------------------- |
| Audit log                   | 7 years  | Fiscal and legal record-keeping                    |
| Email delivery log          | 2 years  | Operational                                        |
| Read in-app notifications   | 1 year   | Unread ones are kept                               |
| Unreconciled bank movements | 2 years  | Matches the 730 days of history a consent requests |
| Bank sync jobs              | 2 years  | Operational log of an import run                   |
| Abandoned consent attempts  | 24 hours | Each holds a live consent reference until reaped   |

Three rules that are not simply "delete old things":

- **Reconciled bank movements are not deleted on this schedule.** A matched movement is the
  provenance of a `Receipt`, and fiscal records outlive two years. It follows the
  retention of the receipt it evidences.
- **Consent reaping only touches connections holding no accounts.** Deleting a `BankConnection`
  cascades to `BankAccount` and `BankTransaction`, so the guard is on both status and emptiness.

**Nothing runs on a schedule until `CRON_SECRET` is set** and something calls
`/api/cron/data-retention`; the endpoint returns 503 until then. An instance that has never set
it is retaining everything, whatever this table says.

Account deletion is immediate and complete. There is no grace period and no soft delete.

## 6. Data subject rights

| Right                                 | How                                          | Where                        |
| ------------------------------------- | -------------------------------------------- | ---------------------------- |
| Access (Art. 15)                      | JSON export of every relation on the account | `POST /api/user/export-data` |
| Portability (Art. 20)                 | Same export, machine-readable                | as above                     |
| Erasure (Art. 17)                     | Immediate and complete, by cascade           | `POST /api/user/delete-data` |
| Rectification (Art. 16)               | Edit in the app                              | —                            |
| Restriction / objection (Art. 18, 21) | By arrangement with the operator             | —                            |

The export is **derived from the Prisma schema** (`lib/services/gdpr/export-scope.ts`), not from
a hand-written list, so a relation added to `User` is exported the day it exists. It previously
listed eleven relations against a model with thirty-five.

Two relations are excluded, and the export says so in its own payload: `accounts` and `sessions`
hold NextAuth OAuth and session tokens. Those are login credentials rather than information
about the subject, and a downloadable file containing them would be a security risk to the
person who downloaded it.

**A tenant is not an account holder.** Tenants have no login and no view of their own records. A
subject access request from a tenant is handled by the operator by hand; there is no self-service
export for them. That is a reasonable position for a single
instance and would need revisiting if Situs were offered as a service.

## 7. Security measures

| Measure                                                                       | Where                                                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AES-256-GCM at rest for the fields in §3                                      | `lib/utils/pii-encryption.ts`                                                                                                     |
| Refuses to start in production without `PII_ENCRYPTION_KEY`                   | `instrumentation.ts` runs `lib/utils/env.ts` at startup; `encryptPII` returns plaintext without a key                             |
| Per-request CSP nonce, HSTS, frame/content-type/referrer/permissions policies | `proxy.ts`, on every response                                                                                                     |
| `userId` scoping on API routes                                                | `requireAuth` / `requireOwnerAccess`                                                                                              |
| Rate limiting                                                                 | `lib/utils/rate-limit.ts` (`withRateLimit`) and `lib/middleware/rate-limit.ts` (TOTP verify) — `docs/SECURITY.md`                 |
| Registration closed by default                                                | `lib/services/auth/registration.ts` — the first account owns the instance; every other email is refused before any row is written |
| Audit trail on workflow mutations                                             | `lib/services/audit-log.ts`, `AuditLog`                                                                                           |
| Debug endpoints restricted in production                                      | `/api/debug/db` and `/api/debug/db/seed` return 403; `/api/debug/db/init` needs a session and `INIT_SECRET` (`docs/SECURITY.md`)  |
| Bank consent references                                                       | 256-bit random, user-scoped, constant-time compared, single-use, dropped once spent                                               |
| Contract reading audited and rate-limited per owner                           | `app/api/contracts/extract/route.ts`: an `EXTRACT_LEASE_CONTRACT` row for every reading, and `EXTRACT_LIMIT`                      |
| Private key handling                                                          | Enable Banking RSA key mounted as a file (`ENABLE_BANKING_PRIVATE_KEY_FILE`), keeping it out of `/proc/<pid>/environ`             |

**Backups are the operator's responsibility.** `docs/DATABASE_STRATEGY.md` describes them; nothing
in the application schedules one. Availability and restorability (Art. 32(1)(c)) are not provided by the application.

## 8. Breach response

No formal procedure is defined, which is honest rather than ideal for a single-operator
instance. The 72-hour notification duty under Article 33 still applies. The material that would
be needed is available: the audit trail records workflow mutations with actor and resource, and
the structured JSON logs cover the application side (`/api/monitoring/errors` answers only in
development).

---

## Known gaps

Listed rather than left for a reader to discover.

- **No breach-response procedure**, per §8.
- **No scheduled backups**, per §7.
- **Tenant subject-access is manual**, per §6.
- **`BankTransaction.reference` is free text held in plaintext** for two years. It is read by
  the matching engine, so encrypting it would cost the reference-month parsing that makes
  matching work. The mitigation is the retention period, not the storage.
- **The transfer basis for contract reading is unconfirmed by the app**, per §4. It rests on the
  terms of the operator's Anthropic account, which the instance cannot see.
- **The SMTP host is not constrained** to the EEA. The default (Brevo) is French, but nothing
  stops `SMTP_HOST` pointing elsewhere, and the app does not check.
