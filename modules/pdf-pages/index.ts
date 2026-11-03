import { requireOptionalNativeModule } from 'expo-modules-core';

type PdfPagesNative = { render(uri: string, width: number, maxPages: number): Promise<{ pages: string[]; total: number }> };

// Optional: on a build without the native side (tests, web) this is null and callers fall
// back to "open with another app" instead of failing.
const native = requireOptionalNativeModule<PdfPagesNative>('PdfPages');

export const pdfPagesAvailable = native !== null;

/** Draws up to `maxPages` pages of a local PDF to images; returns their file:// URIs. */
export async function renderPdfPages(uri: string, width: number, maxPages = 30): Promise<{ pages: string[]; total: number }> {
  if (!native) throw new Error('PDF viewer is not available in this build');
  return native.render(uri, Math.round(width), maxPages);
}
