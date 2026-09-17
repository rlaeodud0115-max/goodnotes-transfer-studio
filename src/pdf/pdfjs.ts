import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

function assetUrl(directory: string): string {
  return typeof document === "undefined"
    ? `${directory}/`
    : new URL(`${directory}/`, document.baseURI).href;
}

export function openPdfDocument(bytes: Uint8Array) {
  const options = {
    data: bytes.slice(),
    // Some Apple-generated PDFs embed Korean CID fonts without a ToUnicode
    // table. PDF.js must load the matching Adobe CMap before it can finish
    // translating the font; otherwise the whole font is skipped and only
    // Latin text/images remain visible.
    cMapUrl: assetUrl("pdfjs-cmaps"),
    cMapPacked: true,
    standardFontDataUrl: assetUrl("pdfjs-standard-fonts"),
    wasmUrl: assetUrl("pdfjs-wasm"),
    useWorkerFetch: true,
    // Safari's native ImageDecoder support differs by device and OS version.
    // PDF.js' bundled OpenJPEG decoder gives Mac and iPad identical JPX pixels.
    isImageDecoderSupported: false,
  };
  return getDocument(options);
}

export type OpenPdfDocumentTask = ReturnType<typeof openPdfDocument>;
