# Copilot Instructions for situs

## 1. Core Technologies

| Layer      | Technology                                       |
| ---------- | ------------------------------------------------ |
| Framework  | Next.js 16 (App Router, standalone output)       |
| UI Library | React 19                                         |
| Language   | TypeScript 5 (strict mode enabled)               |
| Database   | Prisma 7 + SQLite via `better-sqlite3`           |
| Auth       | NextAuth v4 + `@next-auth/prisma-adapter`        |
| Styling    | Tailwind CSS v4 + Radix UI primitives            |
| Validation | Zod v4 (shared frontend ↔ backend)               |
| i18n       | next-intl v4 (locales: `pt` default, `en`, `es`) |
| State      | React Context + custom hooks (no Redux/Zustand)  |
| Animations | framer-motion                                    |
| Icons      | lucide-react                                     |
| Email      | SMTP (`nodemailer`); Brevo by default            |
| Payments   | Stripe                                           |
| Unit tests | Vitest v4 + jsdom + Testing Library              |
| E2E tests  | Playwright (Chromium + mobile Chrome)            |

---

## 2. Architectural Principles

### App Router Structure

- All pages live under `app/[locale]/(main)/<feature>/page.tsx`.
- API routes live under `app/api/<resource>/route.ts`; export named handlers `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`.
- The tenant portal is a separate section under `app/tenant-portal/`.

### API Route Pattern

Every route handler must follow this composition order:

```ts
export const GET = withErrorHandler(withRateLimit(handleGet));
```

- Validate auth with `getAccessContext(request)` or `requireOwnerAccess(request)`.
- Validate request bodies against the corresponding Zod schema before any DB access.
- Sanitize all user inputs with `sanitizeForDatabase` / `sanitizeNumber` before writes.
- Intercept demo mode early via `handleDemoGet` / `handleDemoMutation`.

### Service Layer

- One service module per domain entity in `lib/services/database/<entity>/`.
- Services expose `getAll`, `getById`, `create`, `update`, `delete`; they return plain domain objects (never raw Prisma models).
- Always obtain the Prisma client via `getPrismaClient()` — never import `prisma` directly — so tests can inject a mock.

### Component Layers

| Layer              | Path                            | Rule                                                      |
| ------------------ | ------------------------------- | --------------------------------------------------------- |
| UI primitives      | `components/ui/`                | Generic, stateless, built on Radix UI                     |
| Feature components | `components/features/<domain>/` | Domain-aware, call API routes, compose UI primitives      |
| Shared components  | `components/shared/`            | Cross-feature (Sidebar, Breadcrumbs, ErrorBoundary, etc.) |
| Layout components  | `components/layouts/`           | Top-level layout assembly only                            |

### State Management

- Use React Context (`lib/contexts/`) for global state (app data, currency, toast, theme, demo, portal, CSRF).
- Encapsulate context access in a custom hook (e.g., `useAppContext`).
- Do not introduce new global state managers (Redux, Zustand, Jotai, etc.).

### Schema-First Validation

- Define a Zod schema in `lib/schemas/<entity>.schema.ts` for every domain entity.
- Derive TypeScript types from the schema (`z.infer<typeof MySchema>`).
- Reuse the same schema for both form validation and API body parsing.

---

## 3. Code Style & Formatting

### Formatting (enforced by Prettier)

- **Semicolons**: required.
- **Quotes**: double quotes (`"`).
- **Trailing commas**: `"all"` (functions, arrays, objects).
- **Print width**: 100 characters.
- **Indentation**: 2 spaces.
- **Line endings**: LF.

### Naming Conventions

| Kind                  | Convention                  | Example                                   |
| --------------------- | --------------------------- | ----------------------------------------- |
| Files                 | kebab-case                  | `property-list.tsx`, `use-form-dialog.ts` |
| React components      | PascalCase                  | `PropertyList`, `ConfirmationDialog`      |
| Functions / variables | camelCase                   | `handleGet`, `sanitizeForDatabase`        |
| Custom hooks          | camelCase with `use` prefix | `useFormDialog`, `useSortableData`        |
| Types / Interfaces    | PascalCase                  | `PropertyFormData`, `AuthResult`          |
| Zod schema files      | `<entity>.schema.ts`        | `property.schema.ts`                      |
| Service files         | `<entity>-service.ts`       | `property-service.ts`                     |
| Test files            | `<source-file>.test.ts(x)`  | `property-list.test.tsx`                  |
| Unused params         | `_` prefix                  | `_req`, `_locale`                         |

### TypeScript Rules

- `strict: true` is non-negotiable; do not use `any` (warnings are treated as errors in CI).
- Prefer `unknown` over `any`; narrow types explicitly.
- Use path aliases (`@/ui/*`, `@/features/*`, `@/services/*`, `@/hooks/*`, `@/schemas/*`, `@/types/*`, `@/api/*`) — never use relative `../../` imports across layer boundaries.

### ESLint Rules (key enforced rules)

- `react-hooks/rules-of-hooks`: **error** — hooks must only be called at the top level of React functions.
- `react-hooks/exhaustive-deps`: **warn** — all hook dependencies must be declared.
- `security/detect-eval-with-expression`: **error**.
- `security/detect-unsafe-regex`: **error**.

---

## 4. Testing Strategy

### Unit / Integration Tests (Vitest)

- **Location**: colocate test files alongside source (`<file>.test.ts` / `<file>.test.tsx`).
- **Environment**: jsdom (configured in `vitest.config.ts`).
- **Setup**: `tests/setup.ts` globally mocks `next/navigation`, `next-intl`, and shared contexts.
- **Prisma mock**: use the helper at `tests/helpers/prisma-mock` — never connect to a real DB in unit tests.
- **Component tests**: use `tests/helpers/render-with-providers` to wrap components needing Intl / Currency context.
- **Coverage thresholds** (enforced in CI):
  - Statements: ≥ 70%
  - Lines: ≥ 70%
  - Branches: ≥ 60%
  - Functions: ≥ 60%

### E2E Tests (Playwright)

- **Location**: `e2e/` directory.
- **Browsers**: Desktop Chromium and mobile Chrome (Pixel 5 profile).
- **Auth**: a dedicated `setup` project runs first and stores auth state; all other projects depend on it.
- **Scope**: cover critical user journeys — CRUD for each entity, dashboard smoke, payment flows, tenant portal, lease/property/tenant workflows, compliance, and tax scenarios.
- **CI behaviour**: tests are retried once on failure (`retries: 1` in CI).

### General Expectations

- Every new feature or bug fix must include a corresponding unit test.
- API route handlers must have integration tests that exercise the full middleware stack (auth, rate limiting, validation).
- New E2E scenarios are required for user-facing workflows.

---

## 5. Directory Structure

```
app/
  [locale]/
    (main)/           # Authenticated app pages — add new feature pages here
    layout.tsx        # Locale-level layout
  api/                # Route handlers — one folder per resource
  tenant-portal/      # Tenant-facing portal pages

components/
  ui/                 # Generic, reusable primitives — no domain logic
  features/<domain>/  # Domain-specific components and sub-components
  shared/             # Cross-feature components (Sidebar, Breadcrumbs, etc.)
  layouts/            # Layout assembly components

lib/
  services/
    database/<entity>/  # Prisma-based services — one directory per entity
    auth/               # NextAuth config, middleware, portal auth
    email/              # SMTP transport + email service
    notifications/      # Notification automation
  hooks/              # Custom React hooks (use-*.ts)
  contexts/           # React context providers
  schemas/            # Zod validation schemas (<entity>.schema.ts)
  utils/              # Shared utilities (error-handling, sanitize, rate-limit, etc.)
  i18n/               # next-intl config and locale definitions
  compliance/         # Compliance logic
  tax/                # Tax calculation helpers
  payment/            # Stripe integration
  portal/             # Tenant portal helpers

prisma/               # Prisma schema and migrations
types/                # Global TypeScript declaration files (*.d.ts)
messages/             # i18n JSON files (en.json, pt.json, es.json)
tests/                # Vitest setup file and shared test helpers
e2e/                  # Playwright end-to-end tests
scripts/              # Node.js utility / maintenance scripts
docs/                 # Project documentation
```

### Rules for Placing New Files

- **New page**: `app/[locale]/(main)/<feature>/page.tsx`.
- **New API route**: `app/api/<resource>/route.ts`.
- **New domain component**: `components/features/<domain>/<component-name>.tsx`.
- **New reusable primitive**: `components/ui/<component-name>.tsx`.
- **New service**: `lib/services/database/<entity>/<entity>-service.ts`.
- **New Zod schema**: `lib/schemas/<entity>.schema.ts`.
- **New hook**: `lib/hooks/use-<name>.ts`.
- **New context**: `lib/contexts/<name>-context.tsx`.
- **New utility**: `lib/utils/<purpose>.ts`.
- **New i18n keys**: add to all three files in `messages/` simultaneously.
