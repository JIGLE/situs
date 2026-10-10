import type { MetadataRoute } from "next";

/**
 * Served at /robots.txt (the proxy's matcher leaves `.txt` alone).
 *
 * Situs is one owner's instance, so nothing on it is for a search engine: the sign-in page, the
 * portal and the admin pages are all closed. The two legal pages stay open, deliberately. A PSD2
 * application registration needs a public privacy URL and terms URL that the provider fetches
 * (`tests/legal-pages-contract.test.ts`), and a crawler honouring `Disallow: /` would otherwise
 * read them as "not public". The longest matching rule wins, so `Allow` beats `Disallow: /`.
 *
 * There is no sitemap: nothing here is meant to be indexed beyond those two pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/privacy", "/terms"], disallow: "/" }],
  };
}
