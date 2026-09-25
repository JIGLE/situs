import { describe, it, expect, afterEach } from "vitest";

import {
  __registerProviderForTest,
  configuredProviders,
  getBankProvider,
  getProviderForConnection,
  providerColumnValue,
  providerKeyFromColumn,
  registeredProviders,
} from "./registry";
import { createFakeProvider } from "./fake-provider";

const cleanups: (() => void)[] = [];
function register(provider: ReturnType<typeof createFakeProvider>) {
  cleanups.push(__registerProviderForTest(provider));
  return provider;
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

describe("the provider registry", () => {
  it("ships Enable Banking registered but not configured without credentials", () => {
    // Registration and configuration are different questions. The adapter is compiled in; an
    // instance with no application id and key must still get how to configure one rather than
    // a connect button whose only possible outcome is failure.
    delete process.env.ENABLE_BANKING_APPLICATION_ID;
    delete process.env.ENABLE_BANKING_PRIVATE_KEY;
    expect(registeredProviders().map((p) => p.key)).toContain("enablebanking");
    expect(configuredProviders()).not.toContain("enablebanking");
  });

  it("offers any registered provider that reports itself configured", () => {
    // The regression this exists for: `configuredProviders` used to read
    // `key === "<one vendor>" ? isThatVendorConfigured() : false`, so a second adapter was
    // hardcoded to unconfigured. It could be registered, resolved and fully credentialled, and
    // still never appear — with nothing anywhere reporting why. Revert that ternary and this
    // assertion is what goes red.
    register(createFakeProvider({ key: "alpha", configured: true }));
    expect(configuredProviders()).toContain("alpha");
  });

  it("keeps an unconfigured provider registered but not offered", () => {
    // Registration and configuration are different questions: the adapter exists in the build,
    // this instance just has no secrets for it. `/admin` needs to tell those apart.
    register(createFakeProvider({ key: "beta", configured: false }));
    expect(registeredProviders().map((p) => p.key)).toContain("beta");
    expect(configuredProviders()).not.toContain("beta");
  });

  it("offers several providers at once, sorted", () => {
    register(createFakeProvider({ key: "zulu", configured: true }));
    register(createFakeProvider({ key: "alpha", configured: true }));
    register(createFakeProvider({ key: "mike", configured: false }));
    // Filtered to the fakes: the real adapter is registered too, and whether it is configured
    // depends on environment this case has no business caring about.
    const fakes = configuredProviders().filter((k) => ["alpha", "zulu", "mike"].includes(k));
    expect(fakes).toEqual(["alpha", "zulu"]);
  });

  it("resolves a connection's column back to its provider", () => {
    const provider = register(createFakeProvider({ key: "alpha" }));
    expect(providerColumnValue("alpha")).toBe("psd2_alpha");
    expect(providerKeyFromColumn("psd2_alpha")).toBe("alpha");
    expect(getProviderForConnection("psd2_alpha")).toBe(provider);
  });

  it("treats manual and CSV rows as having no provider", () => {
    // These two must never be offered a sync button or counted as a live feed.
    expect(providerKeyFromColumn("manual")).toBeNull();
    expect(providerKeyFromColumn("csv")).toBeNull();
    expect(getProviderForConnection("manual")).toBeUndefined();
    expect(getProviderForConnection("csv")).toBeUndefined();
  });

  it("resolves nothing for an unknown or empty key", () => {
    expect(getBankProvider("nope")).toBeUndefined();
    expect(getBankProvider(null)).toBeUndefined();
    expect(getBankProvider("")).toBeUndefined();
  });

  it("carries a read budget per provider rather than one global number", () => {
    // The budget is a commercial term of whichever provider is in use, not a property of open
    // banking. It was a module-level constant justified by one vendor's free tier.
    const thrifty = register(createFakeProvider({ key: "thrifty", dailyReadBudget: 1 }));
    const generous = register(createFakeProvider({ key: "generous", dailyReadBudget: 50 }));
    expect(thrifty.dailyReadBudget).toBe(1);
    expect(generous.dailyReadBudget).toBe(50);
  });
});
