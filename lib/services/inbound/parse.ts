/**
 * Brevo Inbound Parsing payloads, normalised.
 *
 * Brevo POSTs `{ items: [...] }` where each item carries From/To/Subject, a raw text body, a
 * raw HTML body, an attachment list of *download tokens* (not bytes), and the original headers.
 *
 * Everything in here is pure and everything in here is untrusted. The parsing is deliberately
 * lenient rather than schema-validated: this is a webhook, and a strict schema that rejects a
 * whole batch because Brevo added a field is a worse failure than a field we ignore. The sibling
 * delivery-event route (`app/api/webhooks/brevo/route.ts`) takes the same approach for the same
 * reason.
 */

/** Caps applied at parse time, so nothing unbounded reaches the database. */
export const LIMITS = {
  /** RFC 5321 maximum path length. */
  address: 320,
  name: 200,
  subject: 500,
  /**
   * 100 KB of text. A real email is a few KB; this is high enough never to truncate a genuine
   * message and low enough that a hostile sender cannot put a novel in a SQLite row.
   */
  body: 100_000,
  messageId: 512,
  authResult: 64,
  filename: 255,
  /** Per message. A tenant sends photos of a leak, not an archive. */
  attachmentCount: 10,
} as const;

export interface BrevoAddress {
  Name?: string | null;
  Address?: string | null;
}

export interface BrevoAttachment {
  Name?: string | null;
  ContentType?: string | null;
  ContentLength?: number | null;
  DownloadToken?: string | null;
}

export interface BrevoInboundItem {
  MessageId?: string | null;
  InReplyTo?: string | null;
  From?: BrevoAddress | null;
  To?: BrevoAddress[] | null;
  Subject?: string | null;
  RawTextBody?: string | null;
  RawHtmlBody?: string | null;
  ExtractedMarkdownMessage?: string | null;
  SentAtDate?: string | null;
  Attachments?: BrevoAttachment[] | null;
  Headers?: Record<string, unknown> | null;
  SpamScore?: number | null;
}

/** What ingestion works with. Flat, bounded, and free of Brevo's naming. */
export interface NormalisedInboundMessage {
  fromAddress: string;
  fromName?: string;
  toAddress: string;
  subject: string;
  textBody: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  spfResult?: string;
  dkimResult?: string;
  receivedAt: Date;
  spamScore?: number;
  attachments: NormalisedAttachment[];
}

export interface NormalisedAttachment {
  filename: string;
  declaredMimeType: string;
  declaredSize: number;
  downloadToken: string;
}

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function optional(value: unknown, max: number): string | undefined {
  const s = clamp(value, max).trim();
  return s.length > 0 ? s : undefined;
}

/**
 * A download token is interpolated into a Brevo API URL, so it is restricted to characters that
 * cannot change the URL's shape. Without this, a token of `../../contacts` would turn an
 * attachment fetch into a request for something else entirely — the payload is attacker-supplied
 * and the URL is ours to build safely.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function isValidDownloadToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/**
 * Anything a browser would start parsing as a tag: `<` or `</` followed by a letter, running to
 * an **optional** `>`.
 *
 * The optional `>` is the whole point. The obvious pattern, `/<[^>]+>/`, requires a closing
 * bracket and so leaves an unterminated tag untouched — `<img src=x onerror=alert(1)` with no
 * `>` passed through this function verbatim before CodeQL caught it. This code makes that input
 * *likelier*, not rarer: `normaliseItem` truncates the HTML at `LIMITS.body` before calling
 * here, which turns well-formed markup into a dangling tag at exactly the cut.
 *
 * Requiring a letter after the bracket is what stops it eating prose. `x < 5` and
 * `I <3 this flat` are things a tenant writes, and a looser `/<[^>]*>?/` would swallow the rest
 * of the line in both.
 */
const TAG_PATTERN = /<\/?[a-zA-Z][^>]*>?/g;

/**
 * Remove tags until none are left.
 *
 * One pass is not enough, and not merely in theory: removing a tag brings the characters on
 * either side of it together, which can form a new one.
 *
 *     "<<<div>div>script>x"  ->  "<<div>script>x"  ->  "<script>x"  ->  "x"
 *
 * Each pass peels one layer, so a nested construction needs as many passes as it has layers.
 * Running to a fixed point is the robust form and is what CodeQL's
 * incomplete-multi-character-sanitization rule asks for. Every pass strictly shortens the
 * string, so this always terminates; the counter is belt and braces, not load-bearing.
 */
function stripTags(input: string): string {
  let current = input;
  for (let pass = 0; pass < 10; pass++) {
    const next = current.replace(TAG_PATTERN, "");
    if (next === current) break;
    current = next;
  }
  return current;
}

/**
 * Strip HTML to readable text.
 *
 * Used only when a message has no plain-text part. The HTML itself is never stored and never
 * rendered — see the note on `InboundMessage.textBody`. Script and style elements are removed
 * *with their contents*, because dropping only the tags would leave the code as body text.
 *
 * None of this makes the output safe to render as HTML, and nothing here should be read as
 * saying it does: `textBody` is text, shown as text. The stripping is defence in depth for the
 * day someone reaches for `dangerouslySetInnerHTML`, not permission to.
 */
export function htmlToText(html: string): string {
  const withoutMarkup = stripTags(
    html
      // `(?:<\/\1\s*>|$)` rather than a required closing tag: a truncated or unclosed <script>
      // otherwise falls through to the generic strip below, which drops the opening tag and
      // leaves the script body sitting in the message as text.
      .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, " ")
      .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, "\n"),
  );

  const decoded = withoutMarkup
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    // Ampersand last, so `&amp;lt;` becomes `&lt;` and not `<`.
    .replace(/&amp;/gi, "&");

  // Stripped again, because decoding is what turns `&lt;script&gt;` into a real tag that the
  // first pass never saw. Costs a sender who encoded tags to write *about* HTML; worth it
  // against a field that could otherwise carry a tag out of this function.
  return stripTags(decoded)
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pull SPF and DKIM verdicts out of the headers Brevo forwards.
 *
 * These are the only evidence on the row about who actually sent the message, so they are read
 * from `Authentication-Results` (the receiving server's verdict) in preference to `Received-SPF`.
 * Stored as the verdict word — pass, fail, softfail, neutral, none — rather than a boolean,
 * because "we could not check" and "the check failed" are different claims about a sender.
 */
export function readAuthResults(headers: Record<string, unknown> | null | undefined): {
  spfResult?: string;
  dkimResult?: string;
} {
  if (!headers || typeof headers !== "object") return {};

  const find = (name: string): string => {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    if (!key) return "";
    const value = headers[key];
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string").join(" ");
    return typeof value === "string" ? value : "";
  };

  const authResults = find("authentication-results");
  const receivedSpf = find("received-spf");

  // Literal patterns rather than one built from a variable: there are exactly two mechanisms,
  // and a RegExp assembled at runtime from anything near attacker-controlled input is a shape
  // worth never having (the lint rule that flags it is right, even though this union is closed).
  const PATTERNS = { spf: /\bspf=([a-z]+)/i, dkim: /\bdkim=([a-z]+)/i } as const;

  const verdict = (source: string, mechanism: keyof typeof PATTERNS): string | undefined => {
    const match = PATTERNS[mechanism].exec(source);
    return match ? match[1].toLowerCase().slice(0, LIMITS.authResult) : undefined;
  };

  return {
    spfResult:
      verdict(authResults, "spf") ??
      // `Received-SPF: pass (domain of ...)` — the verdict is the first word.
      (/^\s*([a-z]+)/i.exec(receivedSpf)?.[1]?.toLowerCase().slice(0, LIMITS.authResult) ||
        undefined),
    dkimResult: verdict(authResults, "dkim"),
  };
}

/** RFC 2822 date, falling back to now — a message with an unparseable date still arrived. */
function parseDate(value: unknown): Date {
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Normalise one Brevo item. Returns null when the item carries no sender address, which is the
 * one field nothing downstream can work without.
 */
export function normaliseItem(item: BrevoInboundItem): NormalisedInboundMessage | null {
  const fromAddress = optional(item.From?.Address, LIMITS.address)?.toLowerCase();
  if (!fromAddress) return null;

  const toAddress = optional(item.To?.[0]?.Address, LIMITS.address)?.toLowerCase() ?? "";

  const rawText = clamp(item.RawTextBody, LIMITS.body);
  const textBody = rawText.trim()
    ? rawText
    : htmlToText(clamp(item.RawHtmlBody, LIMITS.body)).slice(0, LIMITS.body);

  const { spfResult, dkimResult } = readAuthResults(item.Headers);

  const attachments: NormalisedAttachment[] = (item.Attachments ?? [])
    .filter((a): a is BrevoAttachment => Boolean(a) && typeof a === "object")
    .filter((a) => isValidDownloadToken(a.DownloadToken))
    .slice(0, LIMITS.attachmentCount)
    .map((a) => ({
      filename: optional(a.Name, LIMITS.filename) ?? "attachment",
      declaredMimeType: optional(a.ContentType, 128) ?? "application/octet-stream",
      declaredSize:
        typeof a.ContentLength === "number" && a.ContentLength > 0 ? a.ContentLength : 0,
      downloadToken: a.DownloadToken as string,
    }));

  return {
    fromAddress,
    fromName: optional(item.From?.Name, LIMITS.name),
    toAddress,
    subject: optional(item.Subject, LIMITS.subject) ?? "(no subject)",
    textBody,
    rfcMessageId: optional(item.MessageId, LIMITS.messageId),
    inReplyTo: optional(item.InReplyTo, LIMITS.messageId),
    spfResult,
    dkimResult,
    receivedAt: parseDate(item.SentAtDate),
    spamScore: typeof item.SpamScore === "number" ? item.SpamScore : undefined,
    attachments,
  };
}

/** Pull the item list out of a payload, tolerating a bare item or a bare array. */
export function readItems(body: unknown): BrevoInboundItem[] {
  if (Array.isArray(body)) return body as BrevoInboundItem[];
  if (body && typeof body === "object") {
    const items = (body as { items?: unknown }).items;
    if (Array.isArray(items)) return items as BrevoInboundItem[];
    return [body as BrevoInboundItem];
  }
  return [];
}
