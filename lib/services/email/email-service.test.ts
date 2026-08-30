import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * What remains after the templated-email path was removed.
 *
 * Two tests here exercised `sendTemplatedEmail`, which is gone along with `EMAIL_TEMPLATES` and
 * `/api/email` — nothing in the UI called any of it, and the jurisdiction-aware
 * `CorrespondenceTemplate` system supersedes it. They were deleted rather than retargeted at
 * `sendEmail`, because a test rewritten to keep a coverage number up is not a test.
 *
 * No `vi.mock("@sendgrid/mail")` either: the two that used to sit inside `it()` bodies were
 * hoisted by Vitest to the top of the module regardless, shadowed each other, and were never
 * what made those tests pass — the send path was reached by assigning `sendGridClient` on the
 * singleton directly.
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
});
