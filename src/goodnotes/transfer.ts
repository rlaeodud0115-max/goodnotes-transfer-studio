import { PDFDocument } from "pdf-lib";
import { GoodNotesModel, type ModelPage } from "./model";
import { estimateAlignment, type MatchResult, type PageFingerprint } from "../pdf/page-match";
import { buildNormalizedPdf } from "./background";

export interface TransferInput {
  sourceFile: File;
  revisedBytes: Uint8Array;
  backgroundPath: string;
  targetOrder: number[];
  match: MatchResult;
  sourceFingerprints: PageFingerprint[];
  targetFingerprints: PageFingerprint[];
  keepSourcePages?: number[];
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
  const duplicateMainPages: ModelPage[] = [];
  for (const page of mainPages) {
    const sourceIndex = page.pdfPage! - 1, prior = sourcePageByIndex.get(sourceIndex);
    if (!prior) {
      sourcePageByIndex.set(sourceIndex, page);
      continue;
    }
    const priorHasNotes = (model.entries[prior.notePath]?.length ?? 0) > 0;
    const pageHasNotes = (model.entries[page.notePath]?.length ?? 0) > 0;
    // Prefer the sheet containing notes as the canonical page. A second empty
    // sheet over the same PDF page is an orphan that GoodNotes may recover at
    // the beginning of the document unless it is explicitly deleted.
    if (priorHasNotes && !pageHasNotes) {
      duplicateMainPages.push(page);
    } else {
      duplicateMainPages.push(prior);
      sourcePageByIndex.set(sourceIndex, page);
    }
  }
  const blankDuplicatePages = duplicateMainPages.filter((page) => (model.entries[page.notePath]?.length ?? 0) === 0);
  const preservedDuplicatePages = duplicateMainPages.filter((page) => !blankDuplicatePages.includes(page));
  const activeSources = new Set(sourcePageByIndex.keys());
  const mapping = new Map([...input.match.mapping].filter(([source]) => activeSources.has(source)));
  const inverse = new Map<number, number>();
  for (const [source, target] of mapping) if (!inverse.has(target)) inverse.set(target, source);
  const finalPosition = new Map(input.targetOrder.map((target, position) => [target, position]));
  const deletedSources = [...activeSources].filter((source) => !mapping.has(source));
  const requestedKeep = new Set(input.keepSourcePages ?? []);
  const keepAtEnd = deletedSources.filter((source) => requestedKeep.has(source));
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
  // Preserve only note-bearing duplicate sheets. Empty duplicate sheets are
  // explicitly deleted above so GoodNotes cannot recover one at the front.
  finalSlots.push(...preservedDuplicatePages);
  finalSlots.push(...keepAtEnd.map((source) => sourcePageByIndex.get(source)!).filter(Boolean));
  finalSlots.forEach((page, index) => model.setPageOrder(page, orderKey(index)));

  for (const [path, before] of originalNotes) {
    if (before && !equalBytes(before, model.entries[path])) throw new Error("기존 GoodNotes 필기 데이터가 변경되어 저장을 중단했습니다.");
  }
  const bytes = await model.save();
  return { bytes, pagesAdded: addedTargets.length, pagesDeleted: deleteSources.length + blankDuplicatePages.length,
    pagesKeptAtEnd: keepAtEnd.length, finalActivePages: model.activePages.length };
}

function orderKey(index: number): string { return `R${String(index + 1).padStart(10, "0")}`; }
function equalBytes(left: Uint8Array, right: Uint8Array | undefined): boolean {
  if (!right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}
