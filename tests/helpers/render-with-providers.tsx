import React, { createContext } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../messages/en.json";
import ptMessages from "../../messages/pt.json";
import esMessages from "../../messages/es.json";
import itMessages from "../../messages/it.json";

/**
 * All four catalogues, so `initialLocale` actually selects one.
 *
 * It used to take `initialLocale` and then pass `enMessages` regardless — the argument was
 * decorative, and `{ initialLocale: "pt" }` rendered English. That matters more than it sounds:
 * asserting English copy cannot catch a component that hardcodes English, because the hardcoded
 * string is the expected string. Rendering in Portuguese is what makes the difference visible.
 */
const CATALOGUES: Record<string, typeof enMessages> = {
  en: enMessages,
  pt: ptMessages as typeof enMessages,
  es: esMessages as typeof enMessages,
  it: itMessages as typeof enMessages,
};

// Mock Currency Context - provides formatCurrency for tests
interface MockCurrencyContextType {
  currency: string;
  setCurrency: (currency: string) => void;
  formatCurrency: (amount: number) => string;
  locale: string;
}

const MockCurrencyContext = createContext<MockCurrencyContextType | undefined>(undefined);

const MockCurrencyProvider = ({ children }: { children: React.ReactNode }) => {
  const value: MockCurrencyContextType = {
    currency: "USD",
    setCurrency: () => {},
    formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
    locale: "en",
  };

  return <MockCurrencyContext.Provider value={value}>{children}</MockCurrencyContext.Provider>;
};

// Mock Toast Context - provides toast functions for tests
interface MockToastContextType {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const MockToastContext = createContext<MockToastContextType | undefined>(undefined);

const MockToastProvider = ({ children }: { children: React.ReactNode }) => {
  const value: MockToastContextType = {
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {},
  };

  return <MockToastContext.Provider value={value}>{children}</MockToastContext.Provider>;
};

// Mock Theme Context
interface MockThemeContextType {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  systemTheme: "light" | "dark";
}

const MockThemeContext = createContext<MockThemeContextType>({
  theme: "light",
  setTheme: () => {},
  systemTheme: "light",
});

const MockThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const value: MockThemeContextType = {
    theme: "light",
    setTheme: () => {},
    systemTheme: "light",
  };

  return (
    <MockThemeContext.Provider value={value}>
      <div data-testid="mock-theme-provider" data-theme="light">
        {children}
      </div>
    </MockThemeContext.Provider>
  );
};

// Export contexts for tests that need direct access
export { MockCurrencyContext, MockToastContext, MockThemeContext };

interface CustomRenderOptions {
  initialLocale?: string;
  [key: string]: unknown;
}

export function renderWithProviders(ui: React.ReactElement, options?: CustomRenderOptions) {
  const { initialLocale = "en", ...renderOptions } = options ?? {};

  const wrapped = (
    <NextIntlClientProvider
      locale={initialLocale}
      messages={CATALOGUES[initialLocale] ?? enMessages}
    >
      <MockThemeProvider>
        <MockCurrencyProvider>
          <MockToastProvider>{ui}</MockToastProvider>
        </MockCurrencyProvider>
      </MockThemeProvider>
    </NextIntlClientProvider>
  );
  return render(wrapped, renderOptions);
}

export * from "@testing-library/react";
