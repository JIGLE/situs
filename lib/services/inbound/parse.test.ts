import { describe, it, expect } from "vitest";

import {
  htmlToText,
  isValidDownloadToken,
  normaliseItem,
  readAuthResults,
  readItems,
  LIMITS,
} from "./parse";

describe("readItems", () => {
  it("reads Brevo's documented envelope", () => {
    expect(readItems({ items: [{ Subject: "a" }, { Subject: "b" }] })).toHaveLength(2);
  });

  it("tolerates a bare item or a bare array, so a format change does not drop mail", () => {
    expect(readItems({ Subject: "a" })).toHaveLength(1);
    expect(readItems([{ Subject: "a" }])).toHaveLength(1);
  });

  it("returns nothing for a payload that is not an object", () => {
    expect(readItems(null)).toEqual([]);
    expect(readItems("nope")).toEqual([]);
  });
});

describe("isValidDownloadToken", () => {
  /**
   * The token is interpolated into a Brevo API URL. These are the cases that would change the
   * URL's shape rather than its path segment.
   */
  it("rejects anything that could escape the URL path segment", () => {
    for (const bad of [
      "../../contacts",
      "abc/def",
      "abc?query=1",
      "abc#frag",
      "abc def",
      "https://evil.test/x",
      "",
      "a".repeat(257),
    ]) {
      expect(isValidDownloadToken(bad), bad).toBe(false);
    }
  });

  it("accepts the token shape Brevo actually issues", () => {
    expect(isValidDownloadToken("aBc123_-xyz")).toBe(true);
  });
});

describe("htmlToText", () => {
  it("removes script and style CONTENT, not just their tags", () => {
    // Stripping only the tags would leave the code sitting in the message body.
    const text = htmlToText("<p>Hi</p><script>alert(1)</script><style>.a{color:red}</style>");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).toContain("Hi");
  });

  it("turns block ends into line breaks so paragraphs stay readable", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one\ntwo");
    expect(htmlToText("a<br>b")).toBe("a\nb");
  });

  it("decodes the ampersand last, so &amp;lt; stays literal", () => {
    // Decoding & first would turn "&amp;lt;" into "&lt;" and then into "<", inventing markup
    // the sender never wrote.
    expect(htmlToText("<p>&amp;lt;b&amp;gt;</p>")).toBe("&lt;b&gt;");
    expect(htmlToText("<p>a &amp; b</p>")).toBe("a & b");
  });

  it("strips comments, leaving a separator rather than joining what surrounded them", () => {
    // A browser would render "ab" here. We produce "a b" on purpose, consistently with how
    // script and style blocks are replaced: removing an element must never silently weld two
    // pieces of text together, which is a trick for hiding words from a reader.
    expect(htmlToText("a<!-- hidden -->b")).toBe("a b");
  });
});

describe("readAuthResults", () => {
  it("prefers Authentication-Results, which is the receiving server's own verdict", () => {
    expect(
      readAuthResults({
        "Authentication-Results": "mx.test; spf=pass smtp.mailfrom=a.com; dkim=fail header.d=a.com",
      }),
    ).toEqual({ spfResult: "pass", dkimResult: "fail" });
  });

  it("falls back to Received-SPF, whose verdict is the first word", () => {
    expect(readAuthResults({ "Received-SPF": "softfail (domain of a.com ...)" }).spfResult).toBe(
      "softfail",
    );
  });

  it("is case-insensitive about header names", () => {
    expect(readAuthResults({ "authentication-results": "x; spf=pass" }).spfResult).toBe("pass");
  });

  /**
   * "not checked" and "checked and failed" are different claims about a sender, so neither may
   * collapse into the other or into a boolean.
   */
  it("returns undefined rather than a verdict when nothing was checked", () => {
    expect(readAuthResults({})).toEqual({ spfResult: undefined, dkimResult: undefined });
    expect(readAuthResults(null)).toEqual({});
    expect(readAuthResults({ "Authentication-Results": "mx.test; dkim=pass" }).spfResult).toBe(
      undefined,
    );
  });

  it("handles a header delivered as an array", () => {
    expect(
      readAuthResults({ "Authentication-Results": ["mx; spf=pass", "mx; dkim=pass"] }),
    ).toEqual({ spfResult: "pass", dkimResult: "pass" });
  });
});

describe("normaliseItem", () => {
  const base = {
    From: { Name: "Maria Silva", Address: "Maria@Example.COM" },
    To: [{ Address: "rendas@reply.example.com" }],
    Subject: "Fuga de agua",
    RawTextBody: "Bom dia, ha uma fuga na cozinha.",
    MessageId: "<abc@mail.example.com>",
    SentAtDate: "Wed, 5 Jul 2023 10:00:00 +0200",
  };

  it("lowercases addresses so matching is not defeated by capitalisation", () => {
    expect(normaliseItem(base)?.fromAddress).toBe("maria@example.com");
    expect(normaliseItem(base)?.toAddress).toBe("rendas@reply.example.com");
  });

  it("returns null without a sender, the one field nothing downstream works without", () => {
    expect(normaliseItem({ ...base, From: null })).toBeNull();
    expect(normaliseItem({ ...base, From: { Address: "   " } })).toBeNull();
  });

  it("falls back to the HTML part only when there is no text part", () => {
    expect(normaliseItem({ ...base, RawTextBody: "  ", RawHtmlBody: "<p>oi</p>" })?.textBody).toBe(
      "oi",
    );
    // A present text body wins even when HTML is also there.
    expect(normaliseItem({ ...base, RawHtmlBody: "<p>ignored</p>" })?.textBody).toContain("fuga");
  });

  it("substitutes a subject rather than storing an empty string", () => {
    expect(normaliseItem({ ...base, Subject: null })?.subject).toBe("(no subject)");
  });

  it("caps every free-text field so nothing unbounded reaches the database", () => {
    const huge = normaliseItem({
      ...base,
      Subject: "s".repeat(2000),
      RawTextBody: "b".repeat(500_000),
    });
    expect(huge?.subject.length).toBe(LIMITS.subject);
    expect(huge?.textBody.length).toBe(LIMITS.body);
  });

  it("parses the sent date, and falls back to now when it is unusable", () => {
    expect(normaliseItem(base)?.receivedAt.toISOString()).toBe("2023-07-05T08:00:00.000Z");
    expect(normaliseItem({ ...base, SentAtDate: "not a date" })?.receivedAt).toBeInstanceOf(Date);
  });

  it("drops attachments whose download token could rewrite the fetch URL", () => {
    const result = normaliseItem({
      ...base,
      Attachments: [
        { Name: "ok.pdf", ContentType: "application/pdf", ContentLength: 10, DownloadToken: "t1" },
        { Name: "bad.pdf", DownloadToken: "../../contacts" },
        { Name: "none.pdf", DownloadToken: null },
      ],
    });
    expect(result?.attachments.map((a) => a.filename)).toEqual(["ok.pdf"]);
  });

  it("caps attachment count", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ Name: `f${i}`, DownloadToken: `t${i}` }));
    expect(normaliseItem({ ...base, Attachments: many })?.attachments).toHaveLength(
      LIMITS.attachmentCount,
    );
  });

  it("keeps the sender's filename as a label without trusting it", () => {
    // Stored to show; never used to build a path — see attachments.ts.
    const result = normaliseItem({
      ...base,
      Attachments: [{ Name: "../../../etc/passwd", DownloadToken: "t1" }],
    });
    expect(result?.attachments[0].filename).toBe("../../../etc/passwd");
  });
});
