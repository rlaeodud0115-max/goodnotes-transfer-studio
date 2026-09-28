import { PDFDocument } from "pdf-lib";
import { GoodNotesModel, invalidateAttachmentSearch, type ModelPage } from "./model";
import { estimateAlignment, type MatchResult, type PageFingerprint } from "../pdf/page-match";
import { buildNormalizedPdf } from "./background";
import { classifyExistingPages, placeKeptPagesAtOriginalBoundaries } from "./existing-pages";

export interface TransferInput {
  sourceFile: File;
  revisedBytes: Uint8Array;
  backgroundPath: string;
  targetOrder: number[];
  match: MatchResult;
  sourceFingerprints: PageFingerprint[];
  targetFingerprints: PageFingerprint[];
  keepSourcePages?: number[];
  keepSeparatePageIds?: string[];
}

export interface TransferOutput {
  bytes: Uint8Array;
  pagesAdded: number;
  pagesDeleted: number;
  pagesKeptInPlace: number;
  finalActivePages: number;
}

export async function transferGoodNotes(input: TransferInput): Promise<TransferOutput> {
  const model = await GoodNotesModel.fromFile(input.sourceFile);
  const mainAttachmentIds = model.attachmentIdsForPath(input.backgroundPath);
  const mainAttachmentId = [...mainAttachmentIds][0];
  if (!mainAttachmentId) throw new Error("기존 GoodNotes 배경 attachment를 찾지 못했습니다.");
  const activeBefore = [...model.activePages];
  const classified = classifyExistingPages(
    activeBefore,
    mainAttachmentIds,
    (page) => model.entries[page.notePath]?.length ?? 0,
  );
  const sourcePageByIndex = classified.canonicalBySource;
  const blankDuplicatePages = classified.blankDuplicates;
  const separatePages = classified.separatePages;
  if (!sourcePageByIndex.size) throw new Error("기존 GoodNotes의 활성 PDF 페이지를 찾지 못했습니다.");
  const activeSources = new Set(sourcePageByIndex.keys());
  const mapping = new Map([...input.match.mapping].filter(([source]) => activeSources.has(source)));
  const inverse = new Map<number, number>();
  for (const [source, target] of mapping) if (!inverse.has(target)) inverse.set(target, source);
  const finalPosition = new Map(input.targetOrder.map((target, position) => [target, position]));
  const deletedSources = [...activeSources].filter((source) => !mapping.has(source));
  const requestedKeep = new Set(input.keepSourcePages ?? []);
  const keepInPlaceSources = deletedSources.filter((source) => requestedKeep.has(source));
  const deleteSources = deletedSources.filter((source) => !keepInPlaceSources.includes(source));
  const requestedSeparateKeep = new Set(input.keepSeparatePageIds ?? []);
  const keepSeparatePages = separatePages.filter((page) => requestedSeparateKeep.has(page.noteId));
  const deleteSeparatePages = separatePages.filter((page) => !requestedSeparateKeep.has(page.noteId));
  const addedTargets = input.targetOrder.filter((target) => !inverse.has(target));
  const alignment = estimateAlignment(input.sourceFingerprints, input.targetFingerprints, input.match);
  const originalBackground = model.entries[input.backgroundPath]!.slice();
  const separateMainSources = keepSeparatePages.flatMap((page) =>
    page.attachmentId && mainAttachmentIds.has(page.attachmentId) && page.pdfPage != null ? [page.pdfPage - 1] : []);
  const backupSources = [...new Set([...deletedSources, ...separateMainSources])];
  const { bytes: normalized, backupPages, pageSizes } = await buildNormalizedPdf(
    originalBackground, input.revisedBytes, input.targetOrder, inverse, backupSources, alignment,
  );
  model.entries[input.backgroundPath] = normalized;
  // The archive stores extracted PDF words and highlight rectangles separately
  // from the attachment itself. Once the PDF is replaced those coordinates are
  // stale, even if the attachment identity is intentionally reused. Remove only
  // the modified attachment's cache so GoodNotes rebuilds it after import;
  // handwriting/OCR search entries for note pages remain untouched.
  invalidateAttachmentSearch(model.entries, mainAttachmentIds);

  const originalNotes = new Map(model.pages.map((page) => [page.notePath, model.entries[page.notePath]?.slice()]));
  const mappedPages = new Map<number, ModelPage>();
  for (const [source, target] of mapping) {
    const page = sourcePageByIndex.get(source), position = finalPosition.get(target);
    if (!page || position == null) continue;
    // Keep each template's original attachment alias. GoodNotes can store several
    // causal identities for the same PDF path; replacing the alias can trigger
    // an "Early template reference" recovery even though the bytes are shared.
    model.retargetPage(page, page.attachmentId ?? mainAttachmentId, position + 1);
    mappedPages.set(position, page);
  }
  for (const source of deletedSources) {
    const page = sourcePageByIndex.get(source), backup = backupPages.get(source);
    if (!page || backup == null) throw new Error("삭제·보관 페이지의 배경 백업을 만들지 못했습니다.");
    model.retargetPage(page, page.attachmentId ?? mainAttachmentId, backup);
    if (deleteSources.includes(source)) model.deletePage(page);
  }
  for (const page of blankDuplicatePages) model.deletePage(page);
  for (const page of deleteSeparatePages) model.deletePage(page);
  // A retained duplicate sheet can still reference the main PDF page. Preserve
  // that old background in the normalized attachment instead of allowing the
  // duplicate to turn into the revised PDF's page with the same number.
  for (const page of keepSeparatePages) {
    if (!page.attachmentId || !mainAttachmentIds.has(page.attachmentId) || page.pdfPage == null) continue;
    const backup = backupPages.get(page.pdfPage - 1);
    if (backup == null) throw new Error("별도 기존 페이지의 배경 백업을 만들지 못했습니다.");
    model.retargetPage(page, page.attachmentId, backup);
  }

  let templateScale = 1;
  const firstMapped = [...mapping.keys()][0];
  if (firstMapped != null) {
    const sourcePdf = await PDFDocument.load(originalBackground, { updateMetadata: false }).catch(() => null);
    const sourceSize = sourcePdf?.getPage(firstMapped).getSize();
    const page = sourcePageByIndex.get(firstMapped);
    if (page && sourcePdf && sourceSize) templateScale = model.templateScaleForPage(page, sourceSize.width, sourceSize.height);
  }

  const targetSlots: ModelPage[] = [];
  for (let position = 0; position < input.targetOrder.length; position++) {
    const mapped = mappedPages.get(position);
    if (mapped) { targetSlots.push(mapped); continue; }
    const size = pageSizes[position];
    if (!size) throw new Error("새 페이지의 크기를 확인하지 못했습니다.");
    targetSlots.push(model.addPage(mainAttachmentId, position + 1, size.width, size.height, orderKey(position), templateScale));
  }
  const keptPages = [
    ...keepInPlaceSources.map((source) => sourcePageByIndex.get(source)!).filter(Boolean),
    ...keepSeparatePages,
  ];
  const canonicalSourceByPageId = new Map([...sourcePageByIndex].map(([source, page]) => [page.noteId, source]));
  const finalSlots = placeKeptPagesAtOriginalBoundaries(
    targetSlots,
    activeBefore,
    keptPages,
    canonicalSourceByPageId,
    mapping,
    input.targetOrder,
  );
  finalSlots.forEach((page, index) => model.setPageOrder(page, orderKey(index)));

  for (const [path, before] of originalNotes) {
    if (before && !equalBytes(before, model.entries[path])) throw new Error("기존 GoodNotes 필기 데이터가 변경되어 저장을 중단했습니다.");
  }
  const bytes = await model.save();
  return { bytes, pagesAdded: addedTargets.length,
    pagesDeleted: deleteSources.length + blankDuplicatePages.length + deleteSeparatePages.length,
    pagesKeptInPlace: keptPages.length, finalActivePages: model.activePages.length };
}

function orderKey(index: number): string { return `R${String(index + 1).padStart(10, "0")}`; }
function equalBytes(left: Uint8Array, right: Uint8Array | undefined): boolean {
  if (!right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}
