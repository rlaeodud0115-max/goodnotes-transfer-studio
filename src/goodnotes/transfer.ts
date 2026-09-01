import { PDFDocument } from "pdf-lib";
import { GoodNotesModel, type ModelPage } from "./model";
import { estimateAlignment, type MatchResult, type PageFingerprint, type PageAlignment } from "../pdf/page-match";

export interface TransferInput {
  sourceFile: File;
  revisedBytes: Uint8Array;
  backgroundPath: string;
  targetOrder: number[];
  match: MatchResult;
  sourceFingerprints: PageFingerprint[];
  targetFingerprints: PageFingerprint[];
}

export interface TransferOutput {
  bytes: Uint8Array;
  pagesAdded: number;
  pagesDeleted: number;
  pagesKeptAtEnd: number;
  finalActivePages: number;
}

export async function transferGoodNotes(input: TransferInput): Promise<TransferOutput> {
  const model = await GoodNotesModel.fromFile(input.sourceFile);
  const mainAttachmentIds = model.attachmentIdsForPath(input.backgroundPath);
  const mainAttachmentId = [...mainAttachmentIds][0];
  if (!mainAttachmentId) throw new Error("기존 GoodNotes 배경 attachment를 찾지 못했습니다.");
  const activeBefore = [...model.activePages];
  const mainPages = activeBefore.filter((page) => page.attachmentId && mainAttachmentIds.has(page.attachmentId) && page.pdfPage != null);
  if (!mainPages.length) throw new Error("기존 GoodNotes의 활성 PDF 페이지를 찾지 못했습니다.");
  const sourcePageByIndex = new Map<number, ModelPage>();
  for (const page of mainPages) sourcePageByIndex.set(page.pdfPage! - 1, page);
  const activeSources = new Set(sourcePageByIndex.keys());
  const mapping = new Map([...input.match.mapping].filter(([source]) => activeSources.has(source)));
  const inverse = new Map<number, number>();
  for (const [source, target] of mapping) if (!inverse.has(target)) inverse.set(target, source);
  const finalPosition = new Map(input.targetOrder.map((target, position) => [target, position]));
  const deletedSources = [...activeSources].filter((source) => !mapping.has(source));
  const keepAtEnd = deletedSources.filter((source) => {
    const page = sourcePageByIndex.get(source)!;
    return (model.entries[page.notePath]?.length ?? 0) > 0;
  });
  const deleteSources = deletedSources.filter((source) => !keepAtEnd.includes(source));
  const addedTargets = input.targetOrder.filter((target) => !inverse.has(target));
  const alignment = estimateAlignment(input.sourceFingerprints, input.targetFingerprints, input.match);
  const originalBackground = model.entries[input.backgroundPath]!.slice();
  const { bytes: normalized, backupPages, pageSizes } = await buildNormalizedPdf(
    originalBackground, input.revisedBytes, input.targetOrder, inverse, deletedSources, alignment,
  );
  model.entries[input.backgroundPath] = normalized;

  const originalNotes = new Map(model.pages.map((page) => [page.notePath, model.entries[page.notePath]?.slice()]));
  const mappedPages = new Map<number, ModelPage>();
  for (const [source, target] of mapping) {
    const page = sourcePageByIndex.get(source), position = finalPosition.get(target);
    if (!page || position == null) continue;
    model.retargetPage(page, mainAttachmentId, position + 1);
    mappedPages.set(position, page);
  }
  for (const source of deletedSources) {
    const page = sourcePageByIndex.get(source), backup = backupPages.get(source);
    if (!page || backup == null) throw new Error("삭제·보관 페이지의 배경 백업을 만들지 못했습니다.");
    model.retargetPage(page, mainAttachmentId, backup);
    if (deleteSources.includes(source)) model.deletePage(page);
  }

  let templateScale = 1;
  const firstMapped = [...mapping.keys()][0];
  if (firstMapped != null) {
    const sourcePdf = await PDFDocument.load(originalBackground, { updateMetadata: false }).catch(() => null);
    const sourceSize = sourcePdf?.getPage(firstMapped).getSize();
    const page = sourcePageByIndex.get(firstMapped);
    if (page && sourcePdf && sourceSize) templateScale = model.templateScaleForPage(page, sourceSize.width, sourceSize.height);
  }

  const finalSlots: ModelPage[] = [];
  for (let position = 0; position < input.targetOrder.length; position++) {
    const mapped = mappedPages.get(position);
    if (mapped) { finalSlots.push(mapped); continue; }
    const size = pageSizes[position];
    if (!size) throw new Error("새 페이지의 크기를 확인하지 못했습니다.");
    finalSlots.push(model.addPage(mainAttachmentId, position + 1, size.width, size.height, orderKey(position), templateScale));
  }
  const mainSet = new Set(mainPages.map((page) => page.noteId));
  finalSlots.push(...activeBefore.filter((page) => !mainSet.has(page.noteId)));
  finalSlots.push(...keepAtEnd.map((source) => sourcePageByIndex.get(source)!).filter(Boolean));
  finalSlots.forEach((page, index) => model.setPageOrder(page, orderKey(index)));

  for (const [path, before] of originalNotes) {
    if (before && !equalBytes(before, model.entries[path])) throw new Error("기존 GoodNotes 필기 데이터가 변경되어 저장을 중단했습니다.");
  }
  const bytes = await model.save();
  return { bytes, pagesAdded: addedTargets.length, pagesDeleted: deleteSources.length,
    pagesKeptAtEnd: keepAtEnd.length, finalActivePages: model.activePages.length };
}

async function buildNormalizedPdf(
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
  const defaultSize = source.getPages()[0]?.getSize() ?? target.getPages()[0]?.getSize();
  if (!defaultSize) throw new Error("PDF 페이지가 없습니다.");
  const pageSizes: Array<{ width: number; height: number }> = [];
  for (const targetIndex of targetOrder) {
    const targetPage = target.getPage(targetIndex), mappedSource = inverse.get(targetIndex);
    const size = mappedSource != null ? source.getPage(mappedSource).getSize() : defaultSize;
    const page = output.addPage([size.width, size.height]);
    const embedded = await output.embedPage(targetPage);
    const targetSize = targetPage.getSize();
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

function orderKey(index: number): string { return `R${String(index + 1).padStart(10, "0")}`; }
function equalBytes(left: Uint8Array, right: Uint8Array | undefined): boolean {
  if (!right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}
