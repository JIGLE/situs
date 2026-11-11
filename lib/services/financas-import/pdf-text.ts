import { extractText, getDocumentProxy } from "unpdf";

/** Pages beyond this are not read: a caderneta of a large building runs to a few dozen. */
const MAX_PAGES = 80;

/**
 * The text of each page of a PDF, as `unpdf` (pdf.js) lays it out: the items of a page joined by
 * spaces. A scanned PDF has no text layer and gives empty pages, which the caller reports.
 */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    if (pdf.numPages > MAX_PAGES) throw new Error("PDF has too many pages");
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text : [text];
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}
