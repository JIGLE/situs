import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The lease card shows the lease, not a picture of a document. It once opened with a 16:9 grey
 * block holding a `FileText` icon (a placeholder that carried only the status), and the list had a
 * toolbar of two rows: search above, the view toggle alone beneath. This reads the source and names
 * the line.
 */
const file = "components/features/lease/leases-view.tsx";
const lines = readFileSync(join(import.meta.dirname, "..", file), "utf8").split("\n");

const find = (pattern: RegExp) =>
  lines.flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}  ${line.trim()}`] : []));

describe("lease card", () => {
  it("has no placeholder image block", () => {
    expect(find(/aspect-video/)).toEqual([]);
  });

  it("puts the view toggle in the search row", () => {
    const toggle = lines.findIndex((l) => l.includes("<DataViewToggle"));
    const search = lines.findIndex((l) => l.includes("<SearchFilter"));
    expect(toggle).toBeGreaterThan(search);
    // Nothing but the filter's own props sits between them, so no second row opens.
    const between = lines.slice(search, toggle).join("\n");
    expect(between).not.toMatch(/justify-end/);
  });
});
