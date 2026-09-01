import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { decodeDelimited, fields, first, integer, nested, text } from "./wire";

export interface GoodNotesPage {
  noteId: string;
  notePath: string;
  attachmentId?: string;
  pdfPage?: number;
  orderKey?: string;
  deleted: boolean;
}

export interface GoodNotesInspection {
  entries: Record<string, Uint8Array>;
  pages: GoodNotesPage[];
  activePages: GoodNotesPage[];
  backgroundPath: string;
  backgroundAttachmentIds: string[];
  backgroundBytes: Uint8Array;
  backgroundPageCount: number;
  eventVersion: number;
}

const key = (value: string) => value.slice(0, 32);

export async function inspectGoodNotes(file: File): Promise<GoodNotesInspection> {
  if (!file.name.toLowerCase().endsWith(".goodnotes")) throw new Error(".goodnotes 파일을 선택해 주세요.");
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(await file.arrayBuffer())); }
  catch (error) { throw new Error("GoodNotes 문서의 압축 구조를 읽지 못했습니다.", { cause: error }); }
  const notesData = entries["index.notes.pb"];
  const eventsData = entries["index.events.pb"];
  const attachmentsData = entries["index.attachments.pb"];
  if (!notesData || !eventsData || !attachmentsData) throw new Error("GoodNotes 핵심 인덱스가 없습니다.");

  const noteRecords = decodeDelimited(notesData);
  const eventRecords = decodeDelimited(eventsData);
  const attachmentRecords = decodeDelimited(attachmentsData);
  const attachmentPaths = new Map<string, string>();
  for (const record of attachmentRecords) {
    const id = text(first(record, 1));
    const path = text(first(record, 2));
    if (id && path) attachmentPaths.set(id, path);
  }

  const templates = new Map<string, { attachmentId: string; pdfPage: number }>();
  const creates = new Map<string, { templateId?: string; orderKey?: string }>();
  const reorders = new Map<string, { timestamp: number; orderKey?: string }>();
  const deleted = new Set<string>();
  const versions: number[] = [];
  for (const record of eventRecords) {
    for (const field of fields(record, 2)) {
      const message = nested(field);
      const templateId = text(first(message, 2));
      const attachmentId = text(first(message, 4));
      const pdfPage = integer(first(message, 5));
      const version = integer(first(message, 21));
      if (version) versions.push(version);
      if (templateId && attachmentId && pdfPage != null) templates.set(key(templateId), { attachmentId, pdfPage });
    }
    for (const fieldNumber of [54, 3]) for (const field of fields(record, fieldNumber)) {
      const message = nested(field);
      const pageId = text(first(message, 2));
      if (!pageId || pageId.length !== 36) continue;
      const templateId = text(first(nested(first(message, 3)), 1));
      const orderKey = text(first(nested(first(message, 4)), 1));
      creates.set(key(pageId), { templateId, orderKey });
      const version = integer(first(message, 15));
      if (version) versions.push(version);
    }
    for (const field of fields(record, 55)) {
      const message = nested(field);
      const pageId = text(first(message, 2));
      if (!pageId) continue;
      const timestamp = integer(first(message, 14)) ?? 0;
      const orderKey = text(first(nested(first(message, 3)), 1));
      const prior = reorders.get(key(pageId));
      if (!prior || timestamp >= prior.timestamp) reorders.set(key(pageId), { timestamp, orderKey });
      const version = integer(first(message, 15));
      if (version) versions.push(version);
    }
    for (const field of fields(record, 56)) {
      const message = nested(field);
      const pageId = text(first(message, 2));
      if (pageId) deleted.add(key(pageId));
      const version = integer(first(message, 15));
      if (version) versions.push(version);
    }
  }

  const pages: GoodNotesPage[] = [];
  for (const record of noteRecords) {
    const noteId = text(first(record, 1));
    const notePath = text(first(record, 2));
    if (!noteId || !notePath) continue;
    const create = creates.get(key(noteId));
    const template = create?.templateId ? templates.get(key(create.templateId)) : undefined;
    pages.push({
      noteId,
      notePath,
      attachmentId: template?.attachmentId,
      pdfPage: template?.pdfPage,
      orderKey: reorders.get(key(noteId))?.orderKey ?? create?.orderKey,
      deleted: deleted.has(key(noteId)),
    });
  }
  pages.sort((left, right) => Number(left.deleted) - Number(right.deleted) || (left.orderKey ?? "").localeCompare(right.orderKey ?? ""));

  const candidates = new Map<string, { bytes: Uint8Array; pageCount: number }>();
  for (const path of new Set(attachmentPaths.values())) {
    const bytes = entries[path];
    if (!bytes || new TextDecoder().decode(bytes.slice(0, 8)).trimStart().slice(0, 5) !== "%PDF-") continue;
    try {
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      candidates.set(path, { bytes, pageCount: pdf.getPageCount() });
    } catch { /* Non-PDF attachments are ignored. */ }
  }
  const ranked = [...candidates.entries()].sort((a, b) => b[1].pageCount - a[1].pageCount || b[1].bytes.length - a[1].bytes.length);
  const background = ranked[0];
  if (!background) throw new Error("GoodNotes 문서에서 배경 PDF를 찾지 못했습니다.");

  const frequency = new Map<number, number>();
  for (const version of versions) frequency.set(version, (frequency.get(version) ?? 0) + 1);
  const eventVersion = [...frequency].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 24;
  return {
    entries,
    pages,
    activePages: pages.filter((page) => !page.deleted),
    backgroundPath: background[0],
    backgroundAttachmentIds: [...attachmentPaths.entries()].filter(([, path]) => path === background[0]).map(([id]) => id),
    backgroundBytes: background[1].bytes,
    backgroundPageCount: background[1].pageCount,
    eventVersion,
  };
}
