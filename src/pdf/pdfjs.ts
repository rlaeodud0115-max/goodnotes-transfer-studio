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
    wasmUrl: assetUrl("pdfjs-wasm"),
    // Safari's native ImageDecoder support differs by device and OS version.
    // PDF.js' bundled OpenJPEG decoder gives Mac and iPad identical JPX pixels.
    isImageDecoderSupported: false,
  };
  return getDocument(options);
}

export type OpenPdfDocumentTask = ReturnType<typeof openPdfDocument>;
