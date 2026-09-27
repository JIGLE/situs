import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("@/lib/utils/logger", () => ({ logger: { warn: warnMock } }));

import { createFakeProvider } from "./providers/fake-provider";
import { __registerProviderForTest } from "./providers/registry";
import { accessEnded, revokeAtBank } from "./connections";

describe("revokeAtBank", () => {
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    unregister?.();
    unregister = undefined;
  });

  it("asks the connection's provider to end the consent", async () => {
    const fake = createFakeProvider({ key: "fake" });
    unregister = __registerProviderForTest(fake);

    await expect(revokeAtBank("psd2_fake", "session-1")).resolves.toBe("revoked");
    expect(fake.revocations).toEqual(["session-1"]);
  });

  it("passes on a consent the provider no longer knows", async () => {
    unregister = __registerProviderForTest(
      createFakeProvider({ key: "fake", revokeResult: "already_gone" }),
    );

    await expect(revokeAtBank("psd2_fake", "session-1")).resolves.toBe("already_gone");
  });

  it("reports a refusal instead of throwing, and never logs the consent id", async () => {
    unregister = __registerProviderForTest(
      createFakeProvider({ key: "fake", revokeResult: new Error("HTTP 403") }),
    );

    await expect(revokeAtBank("psd2_fake", "session-secret")).resolves.toBe("failed");
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warnMock.mock.calls)).not.toContain("session-secret");
  });

  it("has nothing to ask with for a connection whose id was never stored", async () => {
    await expect(revokeAtBank("psd2_fake", null)).resolves.toBe("no_consent_id");
  });

  it("says so when this instance no longer ships the provider", async () => {
    await expect(revokeAtBank("psd2_gone", "session-1")).resolves.toBe("provider_unavailable");
    await expect(revokeAtBank("manual", "session-1")).resolves.toBe("provider_unavailable");
  });

  it("treats only a confirmed end as the access ending", () => {
    expect(accessEnded("revoked")).toBe(true);
    expect(accessEnded("already_gone")).toBe(true);
    expect(accessEnded("failed")).toBe(false);
    expect(accessEnded("no_consent_id")).toBe(false);
    expect(accessEnded("provider_unavailable")).toBe(false);
  });
});
