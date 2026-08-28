import "./helpers/globals";
import { beforeEach, afterEach, vi } from "vitest";
import {
  setPrismaClientForTests,
  resetPrismaClientForTests,
} from "../lib/services/database/database";
import prismaMock from "./helpers/prisma-mock";
import "@testing-library/jest-dom/vitest";

import en from "../public/locales/en/common.json";

// Use an explicit render helper for tests that need Intl / Currency contexts.
// Tests should import `renderWithProviders` from `tests/helpers/render-with-providers`.

// Global mocks for Next.js modules
// These are applied to all tests to avoid repetitive mocking in each test file
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/en/overview"),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  })),
  useParams: vi.fn(() => ({ locale: "en" })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// `next-intl` is deliberately NOT mocked. It used to be, with `useTranslations` stubbed to
// `(key) => key` and `NextIntlClientProvider` reduced to a pass-through — which meant every
// rendered string in every test was a key rather than copy, and the real catalogue that
// `renderWithProviders` passes was inert. No test could assert what a user reads, and none could
// notice a hardcoded English string; six of those shipped into a fully Portuguese UI and every
// one had to be found by reading a screenshot.
//
// A smarter mock that looked up `messages/en.json` was the obvious alternative and is the wrong
// one: nine catalogue entries are ICU plurals, so it would have to reimplement the formatter the
// real library already carries. Components must be rendered through `renderWithProviders`, which
// supplies a real provider and the catalogue for the requested locale.

// Mock react-i18next used by some components (legacy/localized components).
// Return real English strings from `public/locales/en/common.json` so tests
// that assert labels (e.g., "Upload Document") pass.
vi.mock("react-i18next", () => {
  function lookup(key: string) {
    const parts = key.split(".");
    let cur: any = en;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in cur) cur = cur[p];
      else return key;
    }
    return typeof cur === "string" ? cur : key;
  }

  return {
    useTranslation: () => ({
      t: (k: string) => lookup(k),
      i18n: { changeLanguage: vi.fn(), language: "en" },
    }),
    Trans: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Mock currency context - used by many components
vi.mock("@/lib/contexts/currency-context", () => ({
  useCurrency: () => ({
    currency: "USD",
    setCurrency: vi.fn(),
    formatCurrency: (amount: number) => `$${amount?.toFixed(2) ?? "0.00"}`,
    locale: "en",
  }),
  CurrencyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock toast context - used by many components
vi.mock("@/lib/contexts/toast-context", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock theme context
vi.mock("@/lib/contexts/theme-context", () => ({
  useTheme: () => ({
    theme: "light",
    setTheme: vi.fn(),
    systemTheme: "light",
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// jsdom implements no CSSOM view API, so any component that reads a media query on mount
// (SearchFilter decides inline-vs-collapsed filters that way) throws without this. Defaults to
// the desktop branch, matching the components' own pre-hydration default.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Inject our minimal Prisma mock when DATABASE_URL is not set. This keeps tests
// hermetic and avoids requiring a sqlite file for every run.
if (!process.env.DATABASE_URL) {
  setPrismaClientForTests(prismaMock as any);
}

beforeEach(() => {
  // Reset the in-memory mock to keep tests isolated.
  if ((prismaMock as any).__reset) (prismaMock as any).__reset();
});

afterEach(() => {
  // Keep the injected mock available for the worker lifetime; tests may reset
  // or override it if needed. We still call resetPrismaClientForTests to be
  // safe in case a test replaced the client during a test.
  try {
    resetPrismaClientForTests();
  } catch {}
});
