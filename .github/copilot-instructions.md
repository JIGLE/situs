# Copilot instructions for Situs

`CLAUDE.md` (architecture, key patterns, CI gates, repository rules) and
`docs/REPOSITORY_PROCEDURES.md` (branches, pull requests, releases) are authoritative. This file
summarises the conventions a suggestion most often needs; where it and they differ, they win.

## Stack

Next.js 16 App Router · React 19 · TypeScript (strict) · Prisma 7 + SQLite · NextAuth v4 ·
Tailwind CSS v4 + Radix UI · Zod v4 · next-intl (`pt`, `en`, `es`, `it`) · Vitest + Playwright.

## Conventions

- **API routes** live in `app/api/<resource>/route.ts`. Check the session before touching the
  database (`requireAuth`, or `requireOwnerAccess` / `requireAdmin` where the route needs them, all
  in `lib/services/auth/auth-middleware.ts`) and validate input with Zod first.
- **Database access** goes through `getPrismaClient()` (`lib/services/database/database.ts`), never
  a directly imported client — it applies the PII encryption extension.
- **Components**: `components/ui/` holds primitives with no domain logic;
  `components/features/<domain>/`, `components/shared/` and `components/layouts/` hold the rest.
  Import through the `tsconfig.json` path aliases (`@/ui/*`, `@/features/*`, `@/services/*`, …).
- **Validation**: Zod schemas live in `lib/schemas/<entity>.schema.ts`; derive types with `z.infer`.
- **Naming**: files kebab-case, components PascalCase, hooks `use-<name>.ts(x)` exporting
  `use<Name>`.
- **Text**: every user-facing string goes through next-intl, and a new key goes into all four
  `messages/*.json` files in the same change. Show API errors with `useApiError()` and dates with
  `lib/utils/format-date.ts`, never `err.message` or a bare `toLocaleDateString()`.
- **Tests** sit next to their source as `<file>.test.ts(x)`; shared helpers are in `tests/helpers/`
  and E2E specs in `e2e/`.
- **Formatting and lint**: Prettier (`.prettierrc`) and ESLint with `--max-warnings=0` are the
  source of truth; run `npm run lint` and `npm run type-check` before proposing a change.
