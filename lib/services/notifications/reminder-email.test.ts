import { describe, it, expect, vi, beforeEach } from "vitest";

const sendEmailMock = vi.fn();
vi.mock("@/lib/services/email/email-service", () => ({
  emailService: { sendEmail: (...args: unknown[]) => sendEmailMock(...args) },
}));

const incrementEmailSentMock = vi.fn();
const incrementEmailFailedMock = vi.fn();
vi.mock("@/app/api/metrics/route", () => ({
  incrementEmailSent: () => incrementEmailSentMock(),
  incrementEmailFailed: () => incrementEmailFailedMock(),
}));

import { sendReminderEmail, resetReminderEmailCache } from "./reminder-email";

function makePrisma(user: unknown) {
  const findUnique = vi.fn().mockResolvedValue(user);
  return { user: { findUnique } } as unknown as Parameters<typeof sendReminderEmail>[0];
}

describe("sendReminderEmail", () => {
  beforeEach(() => {
    resetReminderEmailCache();
    sendEmailMock.mockReset();
    incrementEmailSentMock.mockReset();
    incrementEmailFailedMock.mockReset();
  });

  /**
   * rentReminder (D-5) and leaseRenewal (D-60) both have days of runway before anything is
   * actually due, so the in-app Notification row — always written, unconditionally, by the
   * caller in notification-automation.ts — is enough. Only overdueNotice and receiptDeadline
   * still leave the app as email; see URGENT_REMINDER_KINDS.
   */
  it("never emails a demoted reminder, however the landlord's preferences are set", async () => {
    sendEmailMock.mockResolvedValue({ success: true });
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: true, taxReminderNotifications: true },
    });

    await sendReminderEmail(prisma, "user-1", "rentReminder", {
      tenant: "T",
      property: "P",
      amount: "€1",
      date: "d",
    });
    await sendReminderEmail(prisma, "user-1", "leaseRenewal", {
      tenant: "T",
      property: "P",
      date: "d",
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
    // The gate is checked before any lookup, so a demoted kind costs no query either.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("writes to a landlord with no saved language in Portuguese, the app's default", async () => {
    sendEmailMock.mockResolvedValue({ success: true, messageId: "abc" });
    const prisma = makePrisma({ email: "owner@example.com", settings: null });

    await sendReminderEmail(prisma, "user-1", "overdueNotice", {
      tenant: "Maria Silva",
      property: "Sunset Apt. 2A",
      amount: "€950.00",
      days: 1,
    });

    const [emailData] = sendEmailMock.mock.calls[0];
    expect(emailData.subject).toBe("Pagamento em atraso há 1 dia — Sunset Apt. 2A");
  });

  it("sends an urgent email when notifications are enabled", async () => {
    sendEmailMock.mockResolvedValue({ success: true, messageId: "abc" });
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: true, taxReminderNotifications: true },
    });

    await sendReminderEmail(prisma, "user-1", "overdueNotice", {
      tenant: "Maria Silva",
      property: "Sunset Apt. 2A",
      amount: "€950.00",
      days: 1,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [emailData] = sendEmailMock.mock.calls[0];
    expect(emailData.to).toBe("owner@example.com");
    expect(emailData.subject).toBe("Payment overdue by 1 day — Sunset Apt. 2A");
    expect(incrementEmailSentMock).toHaveBeenCalledTimes(1);
  });

  it("skips an urgent email when emailNotifications is disabled", async () => {
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: false, taxReminderNotifications: true },
    });

    await sendReminderEmail(prisma, "user-1", "overdueNotice", {
      tenant: "T",
      property: "P",
      amount: "€1",
      days: 1,
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("defaults to notifications enabled when the user has no settings row", async () => {
    sendEmailMock.mockResolvedValue({ success: true });
    const prisma = makePrisma({ email: "owner@example.com", settings: null });

    await sendReminderEmail(prisma, "user-1", "overdueNotice", {
      tenant: "T",
      property: "P",
      amount: "€1",
      days: 1,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("gates the tax-reminder kind on taxReminderNotifications specifically", async () => {
    sendEmailMock.mockResolvedValue({ success: true });
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: true, taxReminderNotifications: false },
    });

    await sendReminderEmail(
      prisma,
      "user-1",
      "receiptDeadline",
      { tenant: "T", property: "P", amount: "€1" },
      { gate: "tax" },
    );

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not gate the non-tax urgent kind on taxReminderNotifications", async () => {
    sendEmailMock.mockResolvedValue({ success: true });
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: true, taxReminderNotifications: false },
    });

    await sendReminderEmail(prisma, "user-1", "overdueNotice", {
      tenant: "T",
      property: "P",
      amount: "€1",
      days: 1,
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("localizes the email using the user's settings.language", async () => {
    sendEmailMock.mockResolvedValue({ success: true });
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "pt", emailNotifications: true, taxReminderNotifications: true },
    });

    await sendReminderEmail(prisma, "user-1", "overdueNotice", {
      tenant: "Maria",
      property: "Sunset",
      amount: "€1",
      days: 1,
    });

    const [emailData] = sendEmailMock.mock.calls[0];
    expect(emailData.subject).toBe("Pagamento em atraso há 1 dia — Sunset");
  });

  it("does nothing (no throw) when the user no longer exists", async () => {
    const prisma = makePrisma(null);
    await expect(
      sendReminderEmail(prisma, "gone", "overdueNotice", {
        tenant: "T",
        property: "P",
        amount: "€1",
        days: 1,
      }),
    ).resolves.toBeUndefined();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("swallows send failures, increments the failure metric, and never throws", async () => {
    sendEmailMock.mockResolvedValue({ success: false, error: "not configured" });
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: true, taxReminderNotifications: true },
    });

    await expect(
      sendReminderEmail(prisma, "user-1", "overdueNotice", {
        tenant: "T",
        property: "P",
        amount: "€1",
        days: 1,
      }),
    ).resolves.toBeUndefined();
    expect(incrementEmailFailedMock).toHaveBeenCalledTimes(1);
    expect(incrementEmailSentMock).not.toHaveBeenCalled();
  });

  it("swallows a thrown error from the email layer", async () => {
    sendEmailMock.mockRejectedValue(new Error("network down"));
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: true, taxReminderNotifications: true },
    });

    await expect(
      sendReminderEmail(prisma, "user-1", "overdueNotice", {
        tenant: "T",
        property: "P",
        amount: "€1",
        days: 1,
      }),
    ).resolves.toBeUndefined();
    expect(incrementEmailFailedMock).toHaveBeenCalledTimes(1);
  });

  it("caches the user/settings lookup across calls for the same userId within a run", async () => {
    sendEmailMock.mockResolvedValue({ success: true });
    const prisma = makePrisma({
      email: "owner@example.com",
      settings: { language: "en", emailNotifications: true, taxReminderNotifications: true },
    });

    await sendReminderEmail(prisma, "user-1", "overdueNotice", {
      tenant: "A",
      property: "P",
      amount: "€1",
      days: 1,
    });
    await sendReminderEmail(prisma, "user-1", "receiptDeadline", {
      tenant: "B",
      property: "P",
      amount: "€1",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });
});
