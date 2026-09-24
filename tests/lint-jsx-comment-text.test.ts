// @vitest-environment node
/**
 * `situs/jsx-no-comment-textnodes`, the rule in `eslint.config.js` that catches a comment written
 * as JSX text. Between tags, `/* … *\/` and `// …` are text, and React renders them on the page.
 *
 * The rule is tested as the config holds it, and ESLint is asked whether the config turns it on
 * for the app's files: a rule that is defined but never enabled would pass every other case here
 * and catch nothing.
 */
import { describe, it, expect } from "vitest";
import { ESLint, Linter } from "eslint";

// CommonJS, like the plugins it loads.
const config = require("../eslint.config.js") as Linter.Config[];
const rule = config.find((block) => block.plugins?.situs)?.plugins?.situs?.rules?.[
  "jsx-no-comment-textnodes"
];

function lint(lines: string[]) {
  if (!rule) throw new Error("eslint.config.js no longer defines situs/jsx-no-comment-textnodes");
  return new Linter().verify(
    lines.join("\n"),
    [
      {
        files: ["**/*.tsx"],
        languageOptions: { parser: require("@typescript-eslint/parser") },
        plugins: { situs: { rules: { "jsx-no-comment-textnodes": rule } } },
        rules: { "situs/jsx-no-comment-textnodes": "error" },
      },
    ],
    { filename: "view.tsx" },
  );
}

// Loading ESLint and the config's plugins is the slow part, not the assertions.
describe("situs/jsx-no-comment-textnodes", { timeout: 30_000 }, () => {
  it("is an error in the components and pages the app is built from", async () => {
    const eslint = new ESLint();
    for (const file of [
      "components/features/property/property-list.tsx",
      "app/[locale]/(main)/layout.tsx",
    ]) {
      const { rules } = await eslint.calculateConfigForFile(file);
      expect(rules["situs/jsx-no-comment-textnodes"], file).toEqual([2]);
    }
  });

  it("reports a block comment left bare between tags, on the comment's own line", () => {
    const messages = lint([
      "const view = (",
      "  <div>",
      "    /* Tree View */",
      "    <Tree />",
      "  </div>",
      ");",
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      ruleId: "situs/jsx-no-comment-textnodes",
      line: 3,
      column: 5,
    });
  });

  it("reports a line comment inside a fragment", () => {
    const messages = lint([
      "const view = (",
      "  <>",
      "    // Tree View",
      "    <Tree />",
      "  </>",
      ");",
    ]);

    expect(messages.map((m) => m.line)).toEqual([3]);
  });

  it("reports a comment on a later line of the same text", () => {
    const messages = lint([
      "const view = (",
      "  <p>",
      "    Portfolio",
      "    // Tree View",
      "  </p>",
      ");",
    ]);

    expect(messages.map((m) => m.line)).toEqual([4]);
  });

  it("leaves a braced comment, and slashes inside text, alone", () => {
    const messages = lint([
      "const view = (",
      "  <div>",
      "    {/* Tree View */}",
      '    <a href="https://situs.pt">https://situs.pt · €950/month</a>',
      "  </div>",
      ");",
    ]);

    expect(messages).toEqual([]);
  });
});
