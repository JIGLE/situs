function isAsciiLetter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
}

function isHtmlSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/**
 * Skip a raw-text element (<script>/<style>) starting at `start`, returning the
 * index just past its closing tag. The closing tag is matched case-insensitively
 * and tolerates trailing whitespace (e.g. `</script >`), mirroring how the HTML
 * parser terminates raw-text elements. If no valid close is found the remainder
 * of the string is consumed.
 */
function skipRawTextElement(html: string, start: number, tag: string): number {
  const n = html.length;
  const openEnd = html.indexOf(">", start);
  if (openEnd === -1) return n; // unterminated opening tag → drop the rest

  const lower = html.toLowerCase();
  const needle = "</" + tag;
  let i = openEnd + 1;
  for (;;) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) return n; // no closing tag → drop the rest
    const after = idx + needle.length;
    const next = html[after];
    // A valid end tag is followed by whitespace, '/', '>' or end-of-input.
    if (after >= n || next === ">" || next === "/" || isHtmlSpace(next)) {
      const gt = html.indexOf(">", after);
      return gt === -1 ? n : gt + 1;
    }
    i = after;
  }
}

/**
 * Strip all HTML from a string, matching DOMPurify's ALLOWED_TAGS:[] behaviour:
 * - <script> and <style> blocks are removed including their text content
 * - all other tags are removed but their text content is kept
 *
 * Implemented as a single linear forward pass rather than regex filtering, so it
 * is not vulnerable to reconstitution (e.g. `<scr<script>ipt>`) or malformed
 * close-tag bypasses (e.g. `</script >`) the way a regex-based stripper would be.
 */
function stripAllHtml(html: string): string {
  const n = html.length;
  let out = "";
  let i = 0;

  while (i < n) {
    const ch = html[i];
    if (ch !== "<") {
      out += ch;
      i += 1;
      continue;
    }

    // Read the tag name (letters following '<' or '</').
    let j = i + 1;
    if (html[j] === "/") j += 1;
    let name = "";
    while (j < n && isAsciiLetter(html[j])) {
      name += html[j];
      j += 1;
    }
    const lowerName = name.toLowerCase();

    if (lowerName === "script" || lowerName === "style") {
      i = skipRawTextElement(html, i, lowerName);
      continue;
    }

    // Ordinary tag, comment, or stray '<': drop everything up to the next '>'.
    const gt = html.indexOf(">", i + 1);
    if (gt === -1) break; // unterminated '<…' → drop the rest
    i = gt + 1;
  }

  return out.trim();
}

export function sanitizeHtml(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    return "";
  }
  return stripAllHtml(input);
}

export function sanitizeForDatabase(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  const stripped = stripAllHtml(input);
  return (
    String(stripped)
      // Remove named/numeric/hex HTML entities that may remain after sanitization
      .replace(/&#(?:x[0-9a-f]+|\d+);|&[a-z][a-z0-9]+;/gi, " ")
      .replace(/[<>'"&]/g, "") // Remove remaining dangerous characters
      .replace(/\s+/g, " ") // Collapse whitespace
      .trim()
      .slice(0, 10000)
  ); // Limit length to prevent DoS
}

/**
 * Sanitizes filename for safe file operations
 * @param filename - The filename to sanitize
 * @returns Sanitized filename
 */
export function sanitizeFilename(filename: unknown): string {
  if (typeof filename !== "string" || filename.length === 0) {
    return "file";
  }

  let s = String(filename)
    // Normalize path separators to underscore
    .replace(/[\\/]+/g, "_");

  // Collapse directory traversal dots into a safe delimiter
  s = s.replace(/\.\.+/g, "_");

  s = s
    .replace(/[^a-zA-Z0-9._-]+/g, "_") // Replace other unsafe characters with underscore
    .replace(/_+/g, "_") // Replace multiple underscores with single
    .replace(/\.{2,}/g, ".") // Collapse multiple dots
    .replace(/^[_\.]+|[_\.]+$/g, "") // Remove leading/trailing underscores/dots
    .slice(0, 255); // Limit length

  return s;
}

/**
 * Validates and sanitizes email addresses
 * @param email - The email to validate and sanitize
 * @returns Sanitized email or null if invalid
 */
export function sanitizeEmail(email: unknown): string | null {
  if (typeof email !== "string") {
    return null;
  }

  const sanitized = email.trim().toLowerCase();

  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(sanitized)) {
    return null;
  }

  return sanitized;
}

/**
 * An email that may be left out: blank, missing or not a string is none (null); anything else is
 * sanitized.
 *
 * `sanitizeEmail` answers null for a blank email and for one that is not an address alike, so a
 * route that took its answer would read a bad address as none and store nothing, in silence. A
 * non-blank string that is not an address comes back as typed, for the schema to refuse.
 */
export function sanitizeOptionalEmail(email: unknown): string | null {
  if (typeof email !== "string" || !email.trim()) return null;
  return sanitizeEmail(email) ?? email.trim();
}

/**
 * Sanitizes numeric input
 * @param input - The input to convert to number
 * @param defaultValue - Default value if conversion fails
 * @param min - Minimum allowed value
 * @param max - Maximum allowed value
 * @returns Sanitized number
 */
export function sanitizeNumber(
  input: unknown,
  defaultValue: number = 0,
  min?: number,
  max?: number,
): number {
  const num = Number(String(input));

  if (isNaN(num)) {
    return defaultValue;
  }

  if (min !== undefined && num < min) {
    return min;
  }

  if (max !== undefined && num > max) {
    return max;
  }

  return num;
}
