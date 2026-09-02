import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * These inject a transport onto the singleton rather than mocking a mail module.
 *
 * The previous version did the same thing with a `sendGridClient` field, having learned the
 * hard way that a `vi.mock("@sendgrid/mail")` written inside an `it()` body is hoisted to the
 * top of the module and closes over a variable declared in a scope that does not exist yet.
 * The transport seam makes that moot: `MailTransport` is one method, so a fake is three lines
 * and nothing needs the real SMTP module resolved at all.
 */
vi.resetModules();

import type { MailMessage, MailSendResult, MailTransport } from "./transport";

/** A transport that records what it was asked to send. */
function fakeTransport(result: Partial<MailSendResult> = {}) {
  const sent: MailMessage[] = [];
  const transport: MailTransport = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
      return {
        messageId: "message-123",
        accepted: [message.to].flat(),
        rejected: [],
        ...result,
      };
    }),
  };
  return { transport, sent };
}

async function loadService() {
  vi.resetModules();
  const mod = await import("@/lib/services/email/email-service");
  return mod.emailService as import("@/lib/services/email/email-service").EmailService;
}

function inject(service: unknown, transport: MailTransport) {
  const internals = service as unknown as Record<string, unknown>;
  internals["transport"] = transport;
  internals["isInitialized"] = true;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SMTP_HOST;
});

describe("EmailService", () => {
  it("is not ready when no SMTP host is configured", async () => {
    delete process.env.SMTP_HOST;
    const service = await loadService();
    expect(service.isReady()).toBe(false);
  });

  it("sends a templated email and returns the provider message id", async () => {
    process.env.SMTP_HOST = "smtp-relay.brevo.test";
    const service = await loadService();
    const { transport, sent } = fakeTransport();
    inject(service, transport);

    const res = await service.sendTemplatedEmail(
      "rent_reminder",
      "test@example.com",
      { tenantName: "John", propertyAddress: "1 Main St", rentAmount: "100" },
      "user-1",
    );

    expect(res.success).toBe(true);
    expect(res.messageId).toBe("message-123");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("test@example.com");
  });

  it("carries the rendered subject and body through to the transport", async () => {
    process.env.SMTP_HOST = "smtp-relay.brevo.test";
    const service = await loadService();
    const { transport, sent } = fakeTransport();
    inject(service, transport);

    await service.sendTemplatedEmail(
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

    expect(sent[0].subject).toBeTruthy();
    // The template interpolates the tenant's name; an un-rendered template would still have
    // the placeholder here, which is the failure this catches.
    expect(sent[0].html ?? sent[0].text ?? "").toContain("Sam");
  });

  /**
   * The case that used to look like success. An SMTP server can accept the envelope and reject
   * every recipient — an unknown mailbox, a blocklisted domain — and nodemailer reports that as
   * a resolved promise with an empty `accepted`. Reading only "did send() throw?" recorded a
   * rent reminder as delivered when nobody received it.
   */
  it("treats a send where every recipient was rejected as a failure", async () => {
    process.env.SMTP_HOST = "smtp-relay.brevo.test";
    const service = await loadService();
    const { transport } = fakeTransport({ accepted: [], rejected: ["test@example.com"] });
    inject(service, transport);

    const res = await service.sendTemplatedEmail(
      "rent_reminder",
      "test@example.com",
      { tenantName: "John", propertyAddress: "1 Main St", rentAmount: "100" },
      "user-1",
    );

    expect(res.success).toBe(false);
  });

  it("reports failure rather than throwing when the transport is unconfigured", async () => {
    delete process.env.SMTP_HOST;
    const service = await loadService();

    const res = await service.sendTemplatedEmail(
      "rent_reminder",
      "test@example.com",
      { tenantName: "John", propertyAddress: "1 Main St", rentAmount: "100" },
      "user-1",
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });
});
