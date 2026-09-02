import { describe, it, expect } from "vitest";

import { isMailConfigured, readSmtpConfig } from "./transport";

/**
 * The config reader is where a provider swap actually happens, so its edge cases are the ones
 * that decide whether someone's mail silently stops.
 */
describe("readSmtpConfig", () => {
  it("returns null when no host is set, so an instance with no mail provider still boots", () => {
    expect(readSmtpConfig({})).toBeNull();
    expect(isMailConfigured({})).toBe(false);
  });

  it("treats an empty or whitespace host as unset rather than as a hostname", () => {
    expect(readSmtpConfig({ SMTP_HOST: "" })).toBeNull();
    expect(readSmtpConfig({ SMTP_HOST: "   " })).toBeNull();
  });

  it("defaults to the submission port when none is given", () => {
    expect(readSmtpConfig({ SMTP_HOST: "smtp-relay.brevo.com" })).toMatchObject({
      host: "smtp-relay.brevo.com",
      port: 587,
    });
  });

  /**
   * `secure` is derived rather than configured because getting it wrong produces a hang, not an
   * error: an implicit-TLS client against a STARTTLS port waits for a handshake that never
   * comes. One fewer variable to set wrongly.
   */
  it("uses implicit TLS for 465 and STARTTLS for everything else", () => {
    expect(readSmtpConfig({ SMTP_HOST: "h", SMTP_PORT: "465" })?.secure).toBe(true);
    expect(readSmtpConfig({ SMTP_HOST: "h", SMTP_PORT: "587" })?.secure).toBe(false);
    expect(readSmtpConfig({ SMTP_HOST: "h", SMTP_PORT: "25" })?.secure).toBe(false);
  });

  it("falls back to 587 rather than NaN when the port is not a number", () => {
    // `Number("")` is 0 and `Number("abc")` is NaN; either would produce a connection attempt
    // that fails with something unrelated to the actual mistake.
    expect(readSmtpConfig({ SMTP_HOST: "h", SMTP_PORT: "abc" })?.port).toBe(587);
    expect(readSmtpConfig({ SMTP_HOST: "h", SMTP_PORT: "0" })?.port).toBe(587);
    expect(readSmtpConfig({ SMTP_HOST: "h", SMTP_PORT: "99999" })?.port).toBe(587);
  });

  it("does not trim the password, which may legitimately have edge whitespace", () => {
    const config = readSmtpConfig({ SMTP_HOST: "h", SMTP_USER: "  u  ", SMTP_PASS: " p " });
    expect(config?.user).toBe("u");
    expect(config?.pass).toBe(" p ");
  });

  it("allows an unauthenticated relay", () => {
    // A local postfix or a container-network relay often takes no credentials at all.
    const config = readSmtpConfig({ SMTP_HOST: "localhost", SMTP_PORT: "25" });
    expect(config).toMatchObject({ host: "localhost", port: 25 });
    expect(config?.user).toBeUndefined();
  });

  it("is provider-agnostic — the same shape serves any of them", () => {
    for (const host of [
      "smtp-relay.brevo.com",
      "smtp.resend.com",
      "smtp.mailersend.net",
      "mail.smtp2go.com",
      "email-smtp.eu-west-1.amazonaws.com",
      // Nobody on SendGrid is stranded by the move: it speaks SMTP too.
      "smtp.sendgrid.net",
    ]) {
      expect(readSmtpConfig({ SMTP_HOST: host })).toMatchObject({ host, port: 587 });
    }
  });
});
