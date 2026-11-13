/**
 * The readers are tested over positioned items; this is the one test that runs a real PDF through
 * `unpdf`, so an upgrade that changes pdf.js' document API fails here rather than on an upload.
 */
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { readPdf } from "./pdf-text";

function pdf(...pages: string[]): Uint8Array {
  const doc = new jsPDF();
  pages.forEach((text, i) => {
    if (i > 0) doc.addPage();
    doc.text(text, 20, 20);
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

describe("readPdf", () => {
  it("reads each page as text and as positioned items", async () => {
    const out = await readPdf(pdf("Recibo de renda NIF 123456789", "Segunda página"));

    expect(out.pages).toHaveLength(2);
    expect(out.pages[0]).toContain("123456789");
    expect(out.items).toHaveLength(2);
    expect(out.items[1][0].str).toContain("Segunda");
    expect(out.items[0][0].x).toBeGreaterThan(0);
    expect(out.items[0][0].y).toBeGreaterThan(0);
  });

  it("refuses a PDF with too many pages", async () => {
    const pages = Array.from({ length: 81 }, (_, i) => `p${i}`);
    await expect(readPdf(pdf(...pages))).rejects.toThrow("too many pages");
  });
});
