# Contributing to Situs

## Branching and pull requests

**See [`docs/REPOSITORY_PROCEDURES.md`](docs/REPOSITORY_PROCEDURES.md)** — branch naming, the
merged-PR rule, the exact required-check names, Dependabot and releases all live there, in one
place, because they used to live in three and disagree.

**PR checklist:**

- [ ] `npm run verify:ci` read by **exit code** — see the procedures doc for the two known
      non-green results that are not yours to fix
- [ ] Tests pass and coverage is maintained or improved
- [ ] New UI strings added to all four locale files (`messages/en.json`, `messages/pt.json`,
      `messages/es.json`, `messages/it.json`)
- [ ] Any document the change made false is rewritten in the same commit
- [ ] No secrets committed

## Licensing and Intellectual Property

- This repository is proprietary and all rights are reserved by JIGLE.
- By submitting a contribution, you confirm you have the legal right to submit the change.
- By submitting a contribution, you grant JIGLE the perpetual, worldwide, irrevocable right to use, modify, distribute, relicense, and commercialize the contribution as part of this project.
- Do not submit code, assets, or text you are not authorized to license for proprietary commercial use.

## CI Pipeline

Four GitHub Actions workflows protect the repository, plus one reusable one that never runs on
its own:

| Workflow           | File                  | Trigger                              | Validates                                                                    |
| ------------------ | --------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| **CI**             | `ci.yml`              | PRs to `main`; push to `main`        | Lint, type-check, unit tests, build, smoke, E2E smoke, mobile audit          |
| **Security Scan**  | `security-scan.yml`   | PRs; push to `main`; daily 02:00 UTC | npm audit, custom scan, CodeQL, dependency review, TruffleHog                |
| **Release**        | `release.yml`         | Manual dispatch; push to `main`      | Opens the version-bump PR; on merge tags, releases, checks version integrity |
| **Deploy to GHCR** | `deploy-ghcr.yml`     | Git tag `v*`; manual dispatch        | Docker build, Trivy image scan, push to `ghcr.io/jigle/situs`, SBOM          |
| _(reusable)_       | `reusable-verify.yml` | `workflow_call` only                 | The lint/type-check/test trio CI calls                                       |

There used to be a fifth, `production.yml` ("Production Gate"), running on push to `main`. It
called the same `reusable-verify.yml` and ran a byte-identical build as `ci.yml` on the same
event, so every merge paid for two of everything; its only unique content was a version-integrity
check that raced the Release workflow it was supposed to be checking. Both checks now live in
`release.yml`, where they run after the tag exists.

**Nothing deploys on merge.** Publishing an image is deliberate: cut a release (which tags), and
the tag push is what triggers Deploy to GHCR. A manual dispatch of Deploy to GHCR publishes a
`sha-<short>` tag and never touches `:latest` — only a tag push may claim a version number.

## Design System

### CSS Variables

All design tokens live in `app/globals.css` under the `@theme` block. Always use CSS variables — never raw values outside of design-token definitions.

```css
/* ✅ Correct */
background-color: var(--color-surface-1);
color: var(--color-success);

/* ❌ Avoid */
background-color: rgba(15, 23, 42, 0.8);
color: #22c55e;
```

### Surface Tokens

| Token               | Role                            |
| ------------------- | ------------------------------- |
| `--color-surface-0` | Page background (deepest layer) |
| `--color-surface-1` | Card / panel layer              |
| `--color-surface-2` | Raised panel / popover          |
| `--color-surface-3` | Modal / overlay                 |

### Status Color Semantics

Use semantic status tokens instead of Tailwind atomic colours:

| Meaning | Foreground        | Background              |
| ------- | ----------------- | ----------------------- |
| Success | `--color-success` | `--color-success-muted` |
| Warning | `--color-warning` | `--color-warning-muted` |
| Error   | `--color-error`   | `--color-error-muted`   |
| Info    | `--color-info`    | `--color-info-muted`    |

```tsx
// ✅ Semantic tokens
<Badge className="bg-[var(--color-success-muted)] text-[var(--color-success)]">Active</Badge>

// ❌ Raw Tailwind atomic
<Badge className="bg-green-500/20 text-green-400">Active</Badge>
```

### Border-Radius Scale

| Element                  | Class          |
| ------------------------ | -------------- |
| Cards, dialogs, modals   | `rounded-xl`   |
| Buttons, inputs, selects | `rounded-lg`   |
| Badges, tags, chips      | `rounded-md`   |
| Avatars                  | `rounded-full` |

### JS-Accessible Design Tokens

For values required in JavaScript — chart fills, SVG and canvas colours, anywhere a raw hex
string is needed rather than a class — import from `lib/design-tokens.ts`. It exports one
`tokens` object plus three lookup helpers:

```ts
import { tokens, getPropertyTypeColor, getExpenseCategoryColor } from "@/lib/design-tokens";

const positive = tokens.success; // "#10B981"
const slice = getPropertyTypeColor("apartment"); // "#6366F1"
const bar = getExpenseCategoryColor("utilities"); // "#F59E0B"
```

The helpers (`getOccupancyColor`, `getPropertyTypeColor`, `getExpenseCategoryColor`) fall back
to a neutral rather than returning `undefined`, so an unrecognised category still renders.

Extend `lib/design-tokens.ts` when new JS-accessible tokens are needed — do not hardcode values
in component files. For Tailwind classes prefer the CSS custom-property variants
(`text-[var(--color-primary)]`) over importing a hex.

## i18n Conventions

All user-visible strings must be internationalised. The four locale files must stay in sync:

```
messages/en.json   ← source of truth (English)
messages/pt.json   ← Portuguese
messages/es.json   ← Spanish
messages/it.json   ← Italian
```

`npm run i18n:check:strict` compares all four and is a blocking hygiene gate, so a key added to
three of them fails CI.

**Adding a new key:**

1. Add the key to **all four** files simultaneously
2. Use nested namespaces matching the component domain: `dashboard.portfolioOverview`, `forms.addTenant`
3. Use named parameters for dynamic content: `"leaseExpiresSoon": "Lease expires in {days} days"`
4. Run `npx tsc --noEmit` to verify all `useTranslations()` calls resolve

**Wiring in a component:**

```tsx
import { useTranslations } from "next-intl";

export function MyComponent() {
  const t = useTranslations("dashboard");
  return <h1>{t("portfolioOverview")}</h1>;
}
```

## Local Development

### Prerequisites

- Node.js 22+
- npm 10+

### Setup

```bash
npm install
cp .env.example .env   # fill in required variables
npx prisma generate
npm run dev
```

Open http://localhost:3000

### Commands

```bash
npm run dev             # Development server with hot reload
npm test                # Unit tests (Vitest)
npm run test:coverage   # Unit tests with coverage report
npm run test:watch      # Tests in watch mode
npm run test:e2e        # E2E tests (Playwright)
npm run lint            # ESLint
npm run type-check      # TypeScript check
npm run build           # Production build
```

### Database (Development)

Development uses SQLite by default (set in `.env`):

```bash
npx prisma generate      # Regenerate client after schema changes
npx prisma db push       # Apply schema without creating a migration
npx prisma studio        # Visual database browser
npx prisma migrate dev   # Create a named migration
```

### Release Process

Releases are automated via GitHub Actions:

1. **Actions** → **Release** → **Run workflow**
2. Select bump type: `patch`, `minor`, or `major`
3. Add optional release notes
4. The workflow bumps `package.json`, tags the commit, creates a GitHub Release, and triggers the Docker build/push to GHCR

Semantic versioning: **MAJOR** breaking, **MINOR** backward-compatible features, **PATCH** fixes.
Nothing publishes on merge — see
[`docs/REPOSITORY_PROCEDURES.md`](docs/REPOSITORY_PROCEDURES.md) §5 for the full chain.

### E2E tests are opt-in

Playwright is heavy, so the `e2e` job in `ci.yml` is gated: add the **`run-e2e`** label to a pull
request, or dispatch the `CI` workflow manually. `E2E Smoke` runs on every PR regardless, and is
required.

---

Branch protection mechanics — the required-check contexts and how to apply them — live in
[`.github/BRANCH_PROTECTION.md`](.github/BRANCH_PROTECTION.md).

Thanks for contributing — open an issue or a PR if you need help with the process.
