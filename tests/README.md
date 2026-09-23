# Testing Guide for Situs

This guide provides comprehensive documentation for writing, running, and maintaining tests in the Situs project.

---

## Table of Contents

1. [Test Infrastructure](#test-infrastructure)
2. [Running Tests](#running-tests)
3. [Writing Tests](#writing-tests)
4. [Test Patterns](#test-patterns)
5. [Common Pitfalls](#common-pitfalls)
6. [Mocking Strategy](#mocking-strategy)
7. [Best Practices](#best-practices)

---

## Test Infrastructure

### Tools & Frameworks

- **Test Runner**: [Vitest](https://vitest.dev/) v4.0+
- **React Testing**: [@testing-library/react](https://testing-library.com/react)
- **E2E Testing**: [Playwright](https://playwright.dev/)
- **Mock Data**: Custom Prisma mocks in `tests/helpers/prisma-mock.ts`

### File Organization

Unit tests sit next to their source files; `tests/` holds what spans the codebase:

```
components/features/property/
  properties-view.tsx
  properties-view.test.tsx     ← co-located test
lib/services/email/
  email-service.ts
  email-service.test.ts        ← co-located test
tests/
  *.test.ts(x)                 ← cross-cutting contract tests
  helpers/                     ← shared test utilities
  setup.ts                     ← global setup (vitest `setupFiles`)
e2e/                           ← Playwright specs
```

### Configuration

- **vitest.config.ts**: test runner configuration, including the coverage ratchet
- **tests/setup.ts**: global setup — Next.js module mocks and the in-memory Prisma mock

---

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test property-list.test

# Run E2E tests
npm run test:e2e
```

### Test Modes

- **Mock mode (default)**: No DATABASE_URL set. Uses in-memory Prisma mock for fast, isolated tests
- **SQLite mode**: Set `DATABASE_URL=file:./ci-test.db` and run `npx prisma db push` to use local SQLite database

### Vitest Path Aliases

Tests support all TypeScript path aliases:

```typescript
import { Button } from "@/ui/button"; // components/ui/button
import { PropertyList } from "@/features/property"; // components/features/property
import { emailService } from "@/services/email"; // lib/services/email
import { useFormDialog } from "@/hooks/use-form-dialog"; // lib/hooks/use-form-dialog
import { cn } from "@/utils/utils"; // lib/utils/utils
import { propertySchema } from "@/schemas/property.schema"; // lib/schemas/property.schema
import { ErrorBoundary } from "@/shared/error-boundary"; // components/shared/error-boundary
import { Sidebar } from "@/layouts/sidebar"; // components/layouts/sidebar
import type { Property } from "@/lib/types"; // lib/types
import { GET } from "@/api/properties/route"; // app/api/properties/route
```

---

## Writing Tests

### Component Tests

Use `renderWithProviders` for components that need context:

```typescript
import { describe, it, expect } from 'vitest'
import { renderWithProviders as render, screen } from '@/tests/helpers/render-with-providers'
import { MyComponent } from './my-component'

describe('MyComponent', () => {
  it('renders without crashing', () => {
    const { container } = render(<MyComponent />)
    expect(container).toBeDefined()
  })

  it('displays correct content', () => {
    render(<MyComponent />)
    expect(screen.getByText(/Expected Text/)).toBeDefined()
  })
})
```

### Service Tests

Service tests don't need React providers:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { myService } from "./my-service";

describe("MyService", () => {
  beforeEach(() => {
    // Setup before each test
  });

  it("processes data correctly", async () => {
    const result = await myService.processData({ foo: "bar" });
    expect(result).toEqual({ processed: true });
  });
});
```

---

## Test Patterns

### Pattern 1: Simple Render Test

For components that just need to render without errors:

```typescript
it('renders without crashing', () => {
  const { container } = render(<Component />)
  expect(container).toBeDefined()
})
```

### Pattern 2: Context Dependent

Components that use app contexts:

```typescript
import { vi } from 'vitest'

vi.mock('@/lib/contexts/app-context', () => ({
  useApp: () => ({
    state: { properties: [{ id: '1', name: 'Test Property' }] },
    addProperty: vi.fn(),
  })
}))

it('displays properties from context', () => {
  render(<PropertiesList />)
  expect(screen.getByText('Test Property')).toBeDefined()
})
```

---

## Common Pitfalls

### ❌ Pitfall 1: Wrong Import Paths for Context Mocks

**Wrong:**

```typescript
vi.mock('@/lib/currency-context', () => ({ ... }))
vi.mock('@/lib/toast-context', () => ({ ... }))
```

**Correct:**

```typescript
vi.mock('@/lib/contexts/currency-context', () => ({ ... }))
vi.mock('@/lib/contexts/toast-context', () => ({ ... }))
```

### ❌ Pitfall 2: Missing Next.js Module Mocks

**Problem:** Component uses `usePathname` but test doesn't mock it.

**Solution:** Global mocks in `tests/setup.ts` handle this automatically. For custom mocks:

```typescript
vi.mock("next/navigation", () => ({
  usePathname: () => "/en/overview",
  useRouter: () => ({
    push: vi.fn(),
  }),
}));
```

### ❌ Pitfall 3: Not Wrapping Components in Providers

**Wrong:**

```typescript
import { render } from '@testing-library/react'
render(<MyComponent />) // Missing context providers!
```

**Correct:**

```typescript
import { renderWithProviders as render } from '@/tests/helpers/render-with-providers'
render(<MyComponent />) // Has Intl, Theme, Currency, Toast providers
```

---

## Mocking Strategy

### Global Mocks (tests/setup.ts)

Automatically applied to ALL tests:

- `next/navigation` - Router hooks

`next-intl` is deliberately **not** mocked: `renderWithProviders` passes the real catalogue, so a
test asserts the copy a user reads — and can catch hardcoded English.

### Per-Test Mocks

Use when you need custom behavior:

```typescript
// Mock specific context with custom data
vi.mock("@/lib/contexts/app-context", () => ({
  useApp: () => ({
    state: {
      properties: [{ id: "p1", name: "Test Property" }],
      loading: false,
    },
    addProperty: vi.fn(),
  }),
}));
```

---

## Best Practices

### ✅ DO

1. **Co-locate tests** with source files
2. **Use descriptive test names** that explain what is being tested
3. **Test behavior, not implementation** details
4. **Mock external dependencies** (APIs, databases, contexts)
5. **Use renderWithProviders** for React components
6. **Prefix unused variables** with underscore: `_unusedParam`

### ❌ DON'T

1. **Don't test third-party libraries**
2. **Don't make tests depend on each other**
3. **Don't touch a real database in a unit test** — use the Prisma mock; the `*.integration.test.ts` suites are the exception, each on its own scratch SQLite file
4. **Don't test implementation details**
5. **Don't forget to mock** Next.js and context hooks
6. **Don't ignore TypeScript errors** in tests

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Playwright E2E](https://playwright.dev/)
- [Next.js Testing](https://nextjs.org/docs/testing)
