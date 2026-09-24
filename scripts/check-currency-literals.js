#!/usr/bin/env node
const fs = require("fs").promises;
const path = require("path");

const includeDirs = ["app", "components", "lib", "pages", "src"];
const excludeNames = new Set([".next", "node_modules", "public", "docs", "tests", ".git"]);
const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const findings = [];

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (excludeNames.has(e.name)) continue;
      await walk(p);
    } else if (e.isFile()) {
      if (!exts.has(path.extname(e.name))) continue;
      let content;
      try {
        content = await fs.readFile(p, "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      // Skip the currency symbol definition file (it contains intentional mappings)
      const posix = p.replace(/\\/g, "/");
      // A currency symbol table is the one place a "$" literal belongs: `lib/utils/currency.ts`
      // (CURRENCY_SYMBOLS). There used to be a second, `lib/currency.ts`, deleted with the
      // unreachable legacy pages that were its only importer. The old exclusion named only that
      // one, so the real table was reported and this checker exited 1 forever, which is why
      // nothing ran it.
      if (/\/lib\/utils\/currency\.(ts|js)$/.test(posix)) continue;
      // Tests are not user-facing output. This rule exists to stop a hardcoded symbol reaching a
      // screen; a mock formatter asserting "$0.00" cannot.
      if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(posix)) continue;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Conservative patterns: $ followed by digit (e.g. $100), quoted "$" + var, or standalone "$" string
        // `$1`-`$9` in a .replace() are capture-group backreferences, not currency. Two of the
        // three historical "findings" were exactly this, which is why this checker sat unwired.
        const withoutBackrefs = /\.replace\(/.test(line) ? line.replace(/\$[1-9]/g, "") : line;
        if (
          /\$[0-9]/.test(withoutBackrefs) ||
          /"\$"\s*\+/.test(withoutBackrefs) ||
          /'\$'\s*\+/.test(withoutBackrefs) ||
          /"\$"/.test(withoutBackrefs) ||
          /'\$'/.test(withoutBackrefs)
        ) {
          findings.push({ file: p, line: i + 1, text: line.trim() });
        }
      }
    }
  }
}

async function main() {
  const cwd = process.cwd();
  for (const dir of includeDirs) {
    await walk(path.join(cwd, dir));
  }

  if (findings.length === 0) {
    console.log('No currency literal "$" matches found in source directories.');
    process.exit(0);
  }

  console.log("Currency literal matches found:");
  for (const f of findings) {
    console.log(`${f.file}:${f.line}: ${f.text}`);
  }
  // exit non-zero to make CI checks explicit if any are found
  process.exit(1);
}

main().catch((err) => {
  console.error("Error running currency-literal check:", err);
  process.exit(2);
});
