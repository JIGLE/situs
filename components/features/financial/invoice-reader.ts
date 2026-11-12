import jsQR from "jsqr";

import { csrfHeaders } from "@/lib/utils/api-client";
import { httpError } from "@/lib/utils/api-error";
import { parseAtQr, type InvoiceFields } from "@/lib/utils/invoice-read";

/** The file to keep with the expense once the owner saves it. */
export interface InvoiceUpload {
  blob: Blob;
  mimeType: string;
  name: string;
}

export interface InvoiceRead {
  /** Null when nothing could be read: the owner types the expense, and the file is still kept. */
  fields: InvoiceFields | null;
  upload: InvoiceUpload;
}

/** A phone photo is 4000px and several MB; this keeps the QR code legible and the file small. */
const MAX_SIDE = 2000;

async function readPhoto(file: File): Promise<InvoiceRead> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No canvas");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: "attemptBoth" });
  const fields = code ? parseAtQr(code.data) : null;

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  const name = `${file.name.replace(/\.[^.]+$/, "") || "fatura"}.jpg`;
  return {
    fields,
    upload: blob
      ? { blob, mimeType: "image/jpeg", name }
      : { blob: file, mimeType: file.type, name: file.name },
  };
}

async function readPdfInvoice(file: File): Promise<InvoiceRead> {
  const upload = { blob: file, mimeType: "application/pdf", name: file.name };
  const res = await fetch("/api/expenses/invoice/read", {
    method: "POST",
    headers: csrfHeaders({ "Content-Type": "application/pdf" }),
    body: file,
  });
  // A scan with no text, or a PDF that is not one: the owner types it, the file is still kept.
  if (!res.ok) return { fields: null, upload };
  const body = (await res.json()) as { data?: InvoiceFields };
  const fields = body?.data;
  const found = fields && (fields.total !== undefined || fields.supplierNif !== undefined);
  return { fields: found ? fields : null, upload };
}

/**
 * What an invoice says, for the expense form to fill in and the owner to check: a photo's AT QR
 * code is read here, on the device; a PDF's text by the server, which keeps nothing.
 */
export async function readInvoiceFile(file: File): Promise<InvoiceRead> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  try {
    return isPdf ? await readPdfInvoice(file) : await readPhoto(file);
  } catch {
    return { fields: null, upload: { blob: file, mimeType: file.type, name: file.name } };
  }
}

/** Keeps the invoice of a saved expense; answers the Document's id. */
export async function uploadInvoice(upload: InvoiceUpload, propertyId?: string): Promise<string> {
  const query = new URLSearchParams({ name: upload.name.slice(0, 200) });
  if (propertyId) query.set("propertyId", propertyId);
  const res = await fetch(`/api/expenses/invoice?${query}`, {
    method: "POST",
    headers: csrfHeaders({ "Content-Type": upload.mimeType }),
    body: upload.blob,
  });
  if (!res.ok) throw httpError(res.status);
  const body = (await res.json()) as { data?: { id: string } };
  if (!body?.data?.id) throw httpError(500);
  return body.data.id;
}
