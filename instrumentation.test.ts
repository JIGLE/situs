import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `register()` is what turns the PII key into a startup requirement. Before it existed,
// `lib/utils/env.ts` ran only when one of five routes first loaded, so a production server with no
// PII_ENCRYPTION_KEY booted, answered /api/ready and served until then.
describe("instrumentation register()", () => {
  let exit: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // env.ts validates when it is first evaluated, so each case needs a fresh module registry.
    vi.resetModules();
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "file:./instrumentation-test.db");
    vi.stubEnv("CI", undefined);
    vi.stubEnv("GITHUB_ACTIONS", undefined);
    vi.stubEnv("NEXT_BUILD", undefined);
    vi.stubEnv("PII_ENCRYPTION_KEY", undefined);
    vi.stubEnv("ALLOW_UNENCRYPTED_PII", undefined);
    vi.stubEnv("ENABLE_OAUTH", undefined);
    vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", undefined);
    exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stops a production server that has no PII_ENCRYPTION_KEY", async () => {
    const { register } = await import("./instrumentation");

    await expect(register()).rejects.toThrow("process.exit(1)");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error.mock.calls.flat().join(" ")).toContain("PII_ENCRYPTION_KEY");
  });

  it("lets it start once the key is set", async () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", "a".repeat(64));
    const { register } = await import("./instrumentation");

    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });

  it("does not load the Node.js-only check on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await import("./instrumentation");

    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
  });
});
