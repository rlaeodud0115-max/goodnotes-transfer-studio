import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfSource } from "./composer";

GlobalWorkerOptions.workerSrc = workerUrl;

const documents = new Map<string, ReturnType<typeof getDocument>["promise"]>();

async function open(source: PdfSource) {
  let pending = documents.get(source.id);
  if (!pending) {
    pending = getDocument({ data: source.bytes.slice() }).promise;
    documents.set(source.id, pending);
  }
  return pending;
}

export async function renderThumbnail(source: PdfSource, pageIndex: number, maxWidth = 260): Promise<string> {
  const document = await open(source);
  const page = await document.getPage(pageIndex + 1);
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(2, maxWidth / original.width) });
  const canvas = documentOwnerCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("페이지 미리보기 화면을 만들 수 없습니다.");
  try {
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    page.cleanup();
    // Safari keeps a canvas' backing store after the element becomes unreachable.
    // Shrinking it explicitly is important when many previews are opened repeatedly.
    canvas.width = 1;
    canvas.height = 1;
  }
}

function documentOwnerCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function releasePdfPreviews(sourceIds?: Iterable<string>): Promise<void> {
  const ids = sourceIds ? [...new Set(sourceIds)] : [...documents.keys()];
  const pending = ids.flatMap((id) => {
    const item = documents.get(id);
    documents.delete(id);
    return item ? [item] : [];
  });
  for (const item of pending) {
    try {
      const document = await item;
      await document.destroy();
    } catch {
      // A failed preview has no reusable resources.
    }
  }
}
