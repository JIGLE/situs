/**
 * Hands the browser a PDF that came as Base64 inside an API answer, such as a receipt fetched from
 * AT, to save under `name`. Browser only.
 */
export function downloadBase64Pdf(base64: string, name: string): void {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
