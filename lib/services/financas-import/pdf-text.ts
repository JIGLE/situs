import { extractText, getDocumentProxy } from "unpdf";

/** Pages beyond this are not read: a caderneta of a large building runs to a few dozen. */
const MAX_PAGES = 80;

/** One run of text where the PDF draws it: x from the left, y from the bottom, in points. */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  /** The font pdf.js loaded it in: a filled form draws its values in a font of their own. */
  font: string;
}

export interface PdfContent {
  /** Each page's items joined by spaces, as `unpdf` lays them out. */
  pages: string[];
  /** Each page's items with their positions, for a form whose values are not in reading order. */
  items: PdfItem[][];
}

/**
 * The text of each page of a PDF, as text and as positioned items. A scanned PDF has no text
 * layer and gives empty pages, which the caller reports.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfContent> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    if (pdf.numPages > MAX_PAGES) throw new Error("PDF has too many pages");
    const { text } = await extractText(pdf, { mergePages: false });
    const items: PdfItem[][] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const own: PdfItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        own.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          font: item.fontName,
        });
      }
      items.push(own);
    }
    return { pages: Array.isArray(text) ? text : [text], items };
  } finally {
    // The loading task owns the worker; pdf.js 5 (unpdf 2) dropped the document's own destroy().
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
