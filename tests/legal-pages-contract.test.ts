import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The legal pages are the two the outside world reads.
 *
 * Both shipped for months carrying a visible amber banner reading "[Placeholder — this page is
 * pending full legal review. Do not rely on it as legal advice.]", a "Last updated: January
 * 2025" line, `robots: { index: false }`, and English-only prose in an app that ships four
 * locales. None of that is caught by any existing gate: `i18n:check:strict` compares the
 * catalogues to each other and never to what a component actually renders, so hardcoded English
 * is invisible to it — the same blind spot `tests/i18n-no-hardcoded-copy.test.tsx` exists for.
 *
 * It matters beyond tidiness. A production PSD2 application registration requires a privacy URL
 * and a terms URL, and the provider shows the privacy policy to the end user at the moment they
 * authorise access to their bank account. A policy that says "do not rely on this" is a policy
 * a reviewer rejects, and one that never mentions bank data is one that does not describe what
 * the app is asking permission to do.
 */
const ROOT = join(import.meta.dirname, "..");
const PAGES = ["app/[locale]/privacy/page.tsx", "app/[locale]/terms/page.tsx"];

function source(page: string): string {
  return readFileSync(join(ROOT, page), "utf8");
}

describe("legal pages", () => {
  it.each(PAGES)("%s carries no placeholder disclaimer", (page) => {
    const text = source(page);
    expect(text).not.toMatch(/\[Placeholder/i);
    expect(text).not.toMatch(/pending full legal review/i);
  });

  it.each(PAGES)("%s is indexable", (page) => {
    // Not fatal for reachability — the pages always loaded — but a reviewer checking whether a
    // legal URL is public, or any crawler honouring the meta, reads noindex as "not public".
    expect(source(page)).not.toMatch(/index:\s*false/);
  });

  it.each(PAGES)("%s hardcodes no date", (page) => {
    // "Last updated: January 2025" was still on the page in September 2026. A date in JSX has
    // no reason to move when the content does; it lives in the catalogue now.
    expect(source(page)).not.toMatch(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d/,
    );
  });

  it.each(PAGES)("%s renders its prose from the catalogue", (page) => {
    const text = source(page);
    expect(text).toMatch(/getTranslations\("legal"\)/);

    // A paragraph or list item holding a sentence of literal text rather than a t() call is the
    // regression this is really about: it would be complete in four catalogues and still render
    // English to everyone.
    const literals = [...text.matchAll(/<(p|li)[^>]*>\s*([A-Z][^<>{}]{40,})/g)].map((m) =>
      m[2].trim(),
    );
    expect(literals).toEqual([]);
  });

  it("the privacy policy discloses bank access and names the processor", () => {
    // The policy's processor list was Stripe and SendGrid only, while the app was being prepared
    // to read a real bank account through a third party. Assert against the catalogue, since
    // that is where the prose now lives.
    const en = JSON.parse(readFileSync(join(ROOT, "messages/en.json"), "utf8"));
    const privacy = JSON.stringify(en.legal.privacy);

    expect(privacy).toMatch(/Enable Banking/);
    expect(privacy).toMatch(/PSD2/);
    expect(privacy).toMatch(/read-only/i);
    expect(privacy).toMatch(/IBAN/);
  });

  it("publishes a configurable contact address rather than a hardcoded one", () => {
    // Self-hosted software must not tell an operator's users to write to the project's mailbox.
    for (const page of PAGES) {
      expect(source(page)).not.toMatch(/mailto:[a-z]+@situs\.app/);
    }
    expect(source(PAGES[0])).toMatch(/dataProtectionEmail\(\)/);
  });
});
