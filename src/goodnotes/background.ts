import { PDFDocument } from "pdf-lib";
import type { PageAlignment } from "../pdf/page-match";

export async function buildNormalizedPdf(
  sourceBytes: Uint8Array,
  targetBytes: Uint8Array,
  targetOrder: number[],
  inverse: Map<number, number>,
  backupSources: number[],
  alignment: PageAlignment | null,
) {
  const source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  const target = await PDFDocument.load(targetBytes, { updateMetadata: false });
  const output = await PDFDocument.create();
  if (!source.getPageCount() && !target.getPageCount()) throw new Error("PDF 페이지가 없습니다.");
  const pageSizes: Array<{ width: number; height: number }> = [];
  for (const targetIndex of targetOrder) {
    const targetPage = target.getPage(targetIndex), mappedSource = inverse.get(targetIndex);
    const targetSize = targetPage.getSize();
    if (mappedSource == null) {
      const [copied] = await output.copyPages(target, [targetIndex]);
      if (!copied) throw new Error("새 PDF 페이지를 복사하지 못했습니다.");
      output.addPage(copied);
      pageSizes.push(targetSize);
      continue;
    }
    const size = source.getPage(mappedSource).getSize();
    const page = output.addPage([size.width, size.height]);
    const embedded = await output.embedPage(targetPage);
    if (alignment?.axesAgree && alignment.improves) {
      const width = targetSize.width * alignment.scale, height = targetSize.height * alignment.scale;
      page.drawPage(embedded, { x: alignment.offsetX, y: size.height - alignment.offsetY - height, width, height });
    } else {
      const scale = Math.min(size.width / targetSize.width, size.height / targetSize.height);
      const width = targetSize.width * scale, height = targetSize.height * scale;
      page.drawPage(embedded, { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height });
    }
    pageSizes.push(size);
  }
  const backupPages = new Map<number, number>();
  for (const sourceIndex of [...new Set(backupSources)].sort((a, b) => a - b)) {
    const [copied] = await output.copyPages(source, [sourceIndex]);
    if (!copied) throw new Error("기존 페이지 배경을 백업하지 못했습니다.");
    output.addPage(copied); backupPages.set(sourceIndex, output.getPageCount());
  }
  return { bytes: await output.save({ useObjectStreams: true, addDefaultPage: false }), backupPages, pageSizes };
}
