/**
 * The mail transport: one SMTP client, any provider.
 *
 * This replaces a direct `@sendgrid/mail` dependency. Twilio retired SendGrid's free tier in
 * July 2025 — accounts that were not upgraded were paused, and the floor is now about 20 USD a
 * month — so a self-hosted instance had no working email path unless its operator paid for one.
 *
 * SMTP rather than another vendor SDK, because every candidate speaks it: Brevo, Resend,
 * MailerSend, SMTP2GO, Amazon SES, and SendGrid itself at `smtp.sendgrid.net`. Swapping
 * provider becomes four environment variables instead of a code change, and nobody already on
 * SendGrid is stranded by this — they point the same variables at their existing account.
 *
 * The four `SMTP_*` variables are not new. They have been declared in `.env.example` and
 * validated in `lib/utils/env.ts` the whole time, under a comment reading "Unused unless you
 * implement SMTP support instead of SendGrid". This implements it.
 */

import type { Transporter } from "nodemailer";

import { logger } from "@/lib/utils/logger";

const log = logger.child({ component: "mail-transport" });

/** What a transport must do. Deliberately smaller than nodemailer's surface. */
export interface MailMessage {
  to: string | string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

export interface MailSendResult {
  messageId?: string;
  accepted: string[];
  rejected: string[];
}

export interface MailTransport {
  send(message: MailMessage): Promise<MailSendResult>;
}

/**
 * Just the shape these functions read. `NodeJS.ProcessEnv` carries an index signature that a
 * plain object literal does not satisfy, so typing the parameter as this lets a test pass
 * `{ SMTP_HOST: "h" }` directly instead of casting at every call.
 */
export type EnvSource = Record<string, string | undefined>;

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  /**
   * Implicit TLS. True for port 465; false for 587 and 25, which start plaintext and upgrade
   * via STARTTLS. Getting this backwards produces a hang rather than an error, which is why it
   * is derived from the port instead of being another variable to set wrongly.
   */
  secure: boolean;
}

/**
 * Read SMTP settings from the environment. Returns null when unconfigured, which is a valid
 * state — an instance with no mail provider should start and simply not send, exactly as it
 * did when `SENDGRID_API_KEY` was absent.
 */
export function readSmtpConfig(env: EnvSource = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;

  // 587 is the submission port and what every provider in the list above documents first.
  const port = Number(env.SMTP_PORT?.trim() || "587");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    log.warn("SMTP_PORT is not a valid port; falling back to 587", { value: env.SMTP_PORT });
    return { host, port: 587, user: env.SMTP_USER?.trim(), pass: env.SMTP_PASS, secure: false };
  }

  return {
    host,
    port,
    user: env.SMTP_USER?.trim(),
    // Not trimmed: a password may legitimately begin or end with whitespace.
    pass: env.SMTP_PASS,
    secure: port === 465,
  };
}

/** True when this instance can send mail at all. */
export function isMailConfigured(env: EnvSource = process.env): boolean {
  return readSmtpConfig(env) !== null;
}

/**
 * An SMTP transport over nodemailer.
 *
 * nodemailer is imported dynamically so that an instance with no mail configured never loads
 * it, and so the test suite can substitute a transport without the real module being resolved.
 */
export class SmtpTransport implements MailTransport {
  private transporter?: Transporter;

  constructor(private readonly config: SmtpConfig) {}

  private async ensureTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;

    const nodemailer = await import("nodemailer");
    this.transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth:
        this.config.user && this.config.pass
          ? { user: this.config.user, pass: this.config.pass }
          : undefined,
      // A hung SMTP connection otherwise holds a request open until the platform kills it.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    const transporter = await this.ensureTransporter();
    const info = await transporter.sendMail({
      to: message.to,
      from: message.from,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });

    return {
      messageId: info.messageId,
      // Normalised to strings: nodemailer types these as `Address | string`, and every caller
      // here only ever wants the address.
      accepted: (info.accepted ?? []).map(addressOf),
      rejected: (info.rejected ?? []).map(addressOf),
    };
  }
}

function addressOf(entry: string | { address: string }): string {
  return typeof entry === "string" ? entry : entry.address;
}

/** Build the configured transport, or null when this instance sends no mail. */
export function createMailTransport(env: EnvSource = process.env): MailTransport | null {
  const config = readSmtpConfig(env);
  if (!config) return null;
  return new SmtpTransport(config);
}
