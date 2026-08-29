import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * No `vi.mock("@sendgrid/mail")` here, deliberately.
 *
 * Two of them used to sit inside `it()` bodies. Vitest hoists every `vi.mock` to the top of the
 * module regardless of where it is written, so they ran before any test, the second shadowed the
 * first, and each closed over a `mockSend` declared in a scope that did not exist yet. Vitest
 * warns about exactly this and says it will become an error in a future version.
 *
 * Hoisting them would have silenced the warning while keeping calls that never did anything.
 * Both tests reach the send path by assigning `sendGridClient` on the singleton directly — the
 * comment below already says so — so the module mock was never what made them pass. Deleting is
 * the fix; there is nothing to hoist.
 */
vi.resetModules();

describe("EmailService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("isReady returns false when SENDGRID_API_KEY not set", async () => {
    delete process.env.SENDGRID_API_KEY;
    const mod = await import("@/lib/services/email/email-service");
    const { EmailService } = mod as {
      EmailService: typeof import("@/lib/services/email/email-service").EmailService;
    };
    // create a new instance directly to avoid singleton reuse
    const inst = EmailService.getInstance();
    expect(inst.isReady()).toBe(false);
  });

  it("sendTemplatedEmail succeeds when sendgrid send is mocked and logs are attempted", async () => {
    // Ensure fresh modules and then mock sendgrid
    vi.resetModules();
    const mockSend = vi.fn().mockResolvedValue([{ headers: { "x-message-id": "message-123" } }]);
    process.env.SENDGRID_API_KEY = "fake-key";
    const mod = await import("@/lib/services/email/email-service");
    const { emailService } = mod as {
      emailService: import("@/lib/services/email/email-service").EmailService;
    };
    const testEmailService = emailService as unknown as Record<string, unknown>;

    // Inject mock client directly to avoid external module resolution issues in the test runner
    testEmailService["sendGridClient"] = { setApiKey: vi.fn(), send: mockSend };
    testEmailService["isInitialized"] = true;

    const res = await emailService.sendTemplatedEmail(
      "rent_reminder",
      "test@example.com",
      { tenantName: "John", propertyAddress: "1 Main St", rentAmount: "100" },
      "user-1",
    );
    expect(res.success).toBe(true);
    expect(res.messageId).toBe("message-123");
    expect(mockSend).toHaveBeenCalled();
  });

  it("handles single response object from send and extracts message id", async () => {
    vi.resetModules();
    const mockSend = vi.fn().mockResolvedValue({ headers: { "x-message-id": "single-456" } });
    process.env.SENDGRID_API_KEY = "fake-key";
    const mod = await import("@/lib/services/email/email-service");
    const { emailService } = mod as {
      emailService: import("@/lib/services/email/email-service").EmailService;
    };
    const testEmailService = emailService as unknown as Record<string, unknown>;

    testEmailService["sendGridClient"] = { setApiKey: vi.fn(), send: mockSend };
    testEmailService["isInitialized"] = true;

    const res = await emailService.sendTemplatedEmail(
      "maintenance_complete",
      "test2@example.com",
      {
        tenantName: "Sam",
        propertyAddress: "2 Elm St",
        workDescription: "Fix sink",
        completionDate: "2025-12-01",
      },
      "user-2",
    );
    expect(res.success).toBe(true);
    expect(res.messageId).toBe("single-456");
    expect(mockSend).toHaveBeenCalled();
  });
});
