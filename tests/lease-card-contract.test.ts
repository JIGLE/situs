import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The lease card shows the lease, not a picture of a document. It once opened with a 16:9 grey
 * block holding a `FileText` icon (a placeholder that carried only the status), and the list had a
 * toolbar of two rows: search above, a grid/table toggle alone beneath, and the toggle has since gone. This reads the source and names
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

  // One layout per width, not a switch: the table from `md` up, the cards below it. The switch
  // offered the same leases twice and kept the bulk rent increase in one of the two.
  it("has no grid/table switch", () => {
    expect(find(/DataViewToggle|situs-leases-view-mode/)).toEqual([]);
  });
});
