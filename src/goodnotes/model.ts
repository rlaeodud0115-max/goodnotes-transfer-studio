import { unzipSync, zip } from "fflate";
import {
  decodeDelimited, encodeDelimited, encodeMessage, fields, first, integer, nested,
  setFloat32, setInteger, setNested, setText, text, type WireField, type WireMessage,
} from "./wire";

export interface ModelPage {
  noteId: string;
  notePath: string;
  eventId?: string;
  templateId?: string;
  attachmentId?: string;
  pdfPage?: number;
  orderKey?: string;
  createRecordIndex?: number;
  reorderRecordIndex?: number;
  deleted: boolean;
}

interface TemplateRecord { templateId: string; attachmentId: string; pdfPage: number; recordIndex: number }

export class GoodNotesModel {
  readonly entries: Record<string, Uint8Array>;
  readonly noteRecords: WireMessage[];
  readonly attachmentRecords: WireMessage[];
  readonly eventRecords: WireMessage[];
  readonly attachmentPaths = new Map<string, string>();
  templates = new Map<string, TemplateRecord>();
  pages: ModelPage[] = [];
  documentId?: string;
  eventVersion = 24;
  private maxTimestamp = 0;
  private pageCreateTemplate?: WireMessage;
  private templateEventTemplate?: WireMessage;
  private deleteEventTemplate?: WireMessage;

  private constructor(entries: Record<string, Uint8Array>) {
    this.entries = entries;
    const notes = entries["index.notes.pb"], attachments = entries["index.attachments.pb"], events = entries["index.events.pb"];
    if (!notes || !attachments || !events) throw new Error("GoodNotes 핵심 인덱스를 읽지 못했습니다.");
    this.noteRecords = decodeDelimited(notes);
    this.attachmentRecords = decodeDelimited(attachments);
    this.eventRecords = decodeDelimited(events);
    for (const record of this.attachmentRecords) {
      const id = text(first(record, 1)), path = text(first(record, 2));
      if (id && path) this.attachmentPaths.set(id, path);
    }
    this.refresh();
  }

  static async fromFile(file: File): Promise<GoodNotesModel> {
    try { return new GoodNotesModel(unzipSync(new Uint8Array(await file.arrayBuffer()))); }
    catch (error) { throw new Error("GoodNotes 문서를 수정 가능한 형태로 읽지 못했습니다.", { cause: error }); }
  }

  get activePages(): ModelPage[] { return this.pages.filter((page) => !page.deleted); }
  attachmentIdsForPath(path: string): Set<string> {
    return new Set([...this.attachmentPaths].filter(([, value]) => value === path).map(([id]) => id));
  }

  retargetPage(page: ModelPage, attachmentId: string, pdfPage: number): void {
    if (!page.templateId) throw new Error("페이지의 PDF 배경 연결을 찾지 못했습니다.");
    const template = this.templates.get(uuidKey(page.templateId));
    if (!template) throw new Error("페이지의 template 이벤트를 찾지 못했습니다.");
    const record = this.eventRecords[template.recordIndex];
    const field = record && first(record, 2), message = nested(field);
    if (!field || !message) throw new Error("template 이벤트를 수정하지 못했습니다.");
    setText(message, 4, attachmentId); setInteger(message, 5, pdfPage); field.value = encodeMessage(message);
    template.attachmentId = attachmentId; template.pdfPage = pdfPage;
    page.attachmentId = attachmentId; page.pdfPage = pdfPage;
  }

  addPage(attachmentId: string, pdfPage: number, width: number, height: number, orderKey: string, templateScale: number): ModelPage {
    const templateId = this.cloneTemplateEvent(attachmentId, pdfPage, width, height, templateScale);
    return this.clonePageEvent(templateId, orderKey);
  }

  setPageOrder(page: ModelPage, orderKey: string): void {
    const recordIndex = page.reorderRecordIndex ?? page.createRecordIndex;
    if (recordIndex == null) throw new Error("페이지 순서 이벤트를 찾지 못했습니다.");
    const record = this.eventRecords[recordIndex];
    const field = page.reorderRecordIndex != null ? first(record, 55) : first(record, 54) ?? first(record, 3);
    const message = nested(field);
    if (!field || !message) throw new Error("페이지 순서 이벤트를 수정하지 못했습니다.");
    const wrapperNumber = page.reorderRecordIndex != null ? 3 : 4;
    if (!setOrderKey(first(message, wrapperNumber), orderKey)) {
      setNested(message, wrapperNumber, { fields: [{ number: 1, wireType: 2, value: utf8(orderKey) }] });
    }
    field.value = encodeMessage(message); page.orderKey = orderKey;
  }

  deletePage(page: ModelPage): void {
    if (page.deleted) return;
    if (!page.eventId) throw new Error("삭제할 페이지 이벤트를 찾지 못했습니다.");
    let record: WireMessage;
    if (this.deleteEventTemplate) {
      record = cloneMessage(this.deleteEventTemplate);
      const outer = first(record, 1), field = first(record, 56), message = nested(field);
      if (!outer || !field || !message) throw new Error("페이지 삭제 기준 이벤트가 손상되어 있습니다.");
      outer.value = utf8(page.eventId); setText(message, 2, page.eventId); setText(message, 4, newUuid());
      setText(message, 11, newUuid()); setInteger(message, 14, this.nextTimestamp()); field.value = encodeMessage(message);
    } else {
      if (!this.documentId) throw new Error("문서 ID를 찾지 못해 삭제 이벤트를 만들 수 없습니다.");
      const versionMeta: WireMessage = { fields: [
        { number: 1, wireType: 0, value: 1n },
        { number: 2, wireType: 2, value: encodeMessage({ fields: [
          { number: 1, wireType: 0, value: 1n },
          { number: 2, wireType: 0, value: BigInt(randomUint32()) },
        ] }) },
      ] };
      const style = randomBytes(8);
      const message: WireMessage = { fields: [
        { number: 1, wireType: 2, value: utf8(this.documentId) },
        { number: 2, wireType: 2, value: utf8(page.eventId) },
        { number: 3, wireType: 2, value: encodeMessage(versionMeta) },
        { number: 4, wireType: 2, value: utf8(newUuid()) },
        { number: 10, wireType: 1, value: style },
        { number: 11, wireType: 2, value: utf8(newUuid()) },
        { number: 13, wireType: 0, value: 0n },
        { number: 14, wireType: 0, value: BigInt(this.nextTimestamp()) },
        { number: 15, wireType: 0, value: BigInt(this.eventVersion) },
      ] };
      record = { fields: [
        { number: 1, wireType: 2, value: utf8(page.eventId) },
        { number: 56, wireType: 2, value: encodeMessage(message) },
      ] };
    }
    this.eventRecords.push(record); page.deleted = true;
  }

  templateScaleForPage(page: ModelPage, sourceWidth: number, sourceHeight: number): number {
    if (!page.templateId) return 1;
    const template = this.templates.get(uuidKey(page.templateId));
    const record = template ? this.eventRecords[template.recordIndex] : undefined;
    const dimensions = nested(first(nested(first(record, 2)), 8));
    const width = float32(first(dimensions, 1)), height = float32(first(dimensions, 2));
    const scales = [sourceWidth > 0 && width > 0 ? width / sourceWidth : 0, sourceHeight > 0 && height > 0 ? height / sourceHeight : 0].filter(Boolean);
    return scales.length ? scales.reduce((a, b) => a + b, 0) / scales.length : 1;
  }

  save(): Promise<Uint8Array> {
    this.entries["index.notes.pb"] = encodeDelimited(this.noteRecords);
    this.entries["index.attachments.pb"] = encodeDelimited(this.attachmentRecords);
    this.entries["index.events.pb"] = encodeDelimited(this.eventRecords);
    return new Promise((resolve, reject) => {
      zip(this.entries, { level: 1 }, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
  }

  private refresh(): void {
    this.templates = new Map();
    const creates = new Map<string, { recordIndex: number; templateId?: string; orderKey?: string }>();
    const reorders = new Map<string, { timestamp: number; recordIndex: number; orderKey?: string }>();
      const deleted = new Set<string>();
    const versions = new Map<number, number>();
    for (let recordIndex = 0; recordIndex < this.eventRecords.length; recordIndex++) {
      const record = this.eventRecords[recordIndex]!;
      for (const field of fields(record, 2)) {
        const message = nested(field), documentId = text(first(message, 1)), templateId = text(first(message, 2));
        const attachmentId = text(first(message, 4)), pdfPage = integer(first(message, 5));
        if (documentId && !this.documentId) this.documentId = documentId;
        this.trackVersion(integer(first(message, 21)), versions);
        this.maxTimestamp = Math.max(this.maxTimestamp, integer(first(message, 16)) ?? 0);
        if (templateId && attachmentId && pdfPage != null) {
          this.templates.set(uuidKey(templateId), { templateId, attachmentId, pdfPage, recordIndex });
          this.templateEventTemplate = record;
        }
      }
      for (const fieldNumber of [54, 3]) for (const field of fields(record, fieldNumber)) {
        const message = nested(field), pageId = text(first(message, 2));
        if (!pageId || pageId.length !== 36) continue;
        const templateId = text(first(nested(first(message, 3)), 1));
        creates.set(uuidKey(pageId), { recordIndex, templateId, orderKey: findOrderKey(first(message, 4)) });
        if (fieldNumber === 54) this.pageCreateTemplate = record;
        this.maxTimestamp = Math.max(this.maxTimestamp, integer(first(message, 14)) ?? 0);
        this.trackVersion(integer(first(message, 15)), versions);
      }
      for (const field of fields(record, 55)) {
        const message = nested(field), pageId = text(first(message, 2));
        if (!pageId) continue;
        const timestamp = integer(first(message, 14)) ?? 0, prior = reorders.get(uuidKey(pageId));
        if (!prior || timestamp >= prior.timestamp) reorders.set(uuidKey(pageId), { timestamp, recordIndex, orderKey: findOrderKey(first(message, 3)) });
        this.maxTimestamp = Math.max(this.maxTimestamp, timestamp); this.trackVersion(integer(first(message, 15)), versions);
      }
      for (const field of fields(record, 56)) {
        const message = nested(field), pageId = text(first(message, 2));
        if (pageId) { deleted.add(uuidKey(pageId)); this.deleteEventTemplate = record; }
        this.maxTimestamp = Math.max(this.maxTimestamp, integer(first(message, 14)) ?? 0);
        this.trackVersion(integer(first(message, 15)), versions);
      }
    }
    this.eventVersion = [...versions].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 24;
    this.pages = this.noteRecords.flatMap((record): ModelPage[] => {
      const noteId = text(first(record, 1)), notePath = text(first(record, 2));
      if (!noteId || !notePath) return [];
      const create = creates.get(uuidKey(noteId)), reorder = reorders.get(uuidKey(noteId));
      const template = create?.templateId ? this.templates.get(uuidKey(create.templateId)) : undefined;
      let eventId: string | undefined;
      if (create) {
        const eventRecord = this.eventRecords[create.recordIndex];
        for (const number of [54, 3]) for (const field of fields(eventRecord!, number)) {
          const candidate = text(first(nested(field), 2));
          if (candidate && uuidKey(candidate) === uuidKey(noteId)) eventId = candidate;
        }
      }
      return [{ noteId, notePath, eventId, templateId: template?.templateId ?? create?.templateId,
        attachmentId: template?.attachmentId, pdfPage: template?.pdfPage,
        orderKey: reorder?.orderKey ?? create?.orderKey, createRecordIndex: create?.recordIndex,
        reorderRecordIndex: reorder?.recordIndex, deleted: deleted.has(uuidKey(noteId)) }];
    }).sort((a, b) => Number(a.deleted) - Number(b.deleted) || (a.orderKey ?? "").localeCompare(b.orderKey ?? ""));
  }

  private trackVersion(version: number | undefined, versions: Map<number, number>): void {
    if (version && version >= 1 && version <= 100) versions.set(version, (versions.get(version) ?? 0) + 1);
  }
  private nextTimestamp(): number { return ++this.maxTimestamp; }

  private cloneTemplateEvent(attachmentId: string, pdfPage: number, width: number, height: number, sourceScale: number): string {
    if (!this.templateEventTemplate) throw new Error("새 PDF 페이지를 만들 template 기준 이벤트가 없습니다.");
    const record = cloneMessage(this.templateEventTemplate), outer = first(record, 1), field = first(record, 2), message = nested(field);
    if (!outer || !field || !message) throw new Error("template 기준 이벤트가 손상되어 있습니다.");
    const templateId = newUuid(); outer.value = utf8(templateId); setText(message, 2, templateId);
    setText(message, 4, attachmentId); setInteger(message, 5, pdfPage); setText(message, 11, newUuid()); setInteger(message, 16, this.nextTimestamp());
    const dimensionField = first(message, 8), dimensions = nested(dimensionField);
    if (dimensionField && dimensions) {
      const scale = sourceScale > 0 ? sourceScale : 1;
      setFloat32(dimensions, 1, width * scale); setFloat32(dimensions, 2, height * scale); dimensionField.value = encodeMessage(dimensions);
    }
    field.value = encodeMessage(message); this.eventRecords.push(record);
    this.templates.set(uuidKey(templateId), { templateId, attachmentId, pdfPage, recordIndex: this.eventRecords.length - 1 });
    return templateId;
  }

  private clonePageEvent(templateId: string, orderKey: string): ModelPage {
    if (!this.pageCreateTemplate) throw new Error("새 GoodNotes 페이지를 만들 기준 이벤트가 없습니다.");
    const record = cloneMessage(this.pageCreateTemplate), [eventId, noteId] = newPageUuidPair();
    const outer = first(record, 1); let pageField = first(record, 54);
    if (!pageField) { pageField = first(record, 3); if (pageField) pageField.number = 54; }
    const message = nested(pageField);
    if (!outer || !pageField || !message) throw new Error("페이지 생성 기준 이벤트가 손상되어 있습니다.");
    outer.value = utf8(eventId); setText(message, 2, eventId);
    const wrapperField = first(message, 3), wrapper = nested(wrapperField);
    if (wrapperField && wrapper) { setText(wrapper, 1, templateId); wrapperField.value = encodeMessage(wrapper); }
    else setNested(message, 3, { fields: [{ number: 1, wireType: 2, value: utf8(templateId) }] });
    if (!setOrderKey(first(message, 4), orderKey)) setNested(message, 4, { fields: [{ number: 1, wireType: 2, value: utf8(orderKey) }] });
    setText(message, 11, newUuid()); setInteger(message, 14, this.nextTimestamp()); pageField.value = encodeMessage(message);
    this.eventRecords.push(record);
    const notePath = `notes/${noteId}`;
    this.noteRecords.push({ fields: [{ number: 1, wireType: 2, value: utf8(noteId) }, { number: 2, wireType: 2, value: utf8(notePath) }] });
    this.entries[notePath] = new Uint8Array();
    const template = this.templates.get(uuidKey(templateId))!;
    const page: ModelPage = { noteId, notePath, eventId, templateId, attachmentId: template.attachmentId,
      pdfPage: template.pdfPage, orderKey, createRecordIndex: this.eventRecords.length - 1, deleted: false };
    this.pages.push(page); return page;
  }
}

// Historical GoodNotes files use the final UUID group as a revision suffix
// when linking event records to note records.
export function uuidKey(value: string): string { return value.slice(0, 32); }
function newUuid(): string { return crypto.randomUUID().toUpperCase(); }
function newPageUuidPair(): [string, string] {
  const base = newUuid(), digit = randomUint32() % 15;
  return [base.slice(0, -1) + digit.toString(16).toUpperCase(), base.slice(0, -1) + (digit + 1).toString(16).toUpperCase()];
}
function randomUint32(): number { const value = new Uint32Array(1); crypto.getRandomValues(value); return value[0] ?? 0; }
function randomBytes(length: number): Uint8Array { const value = new Uint8Array(length); crypto.getRandomValues(value); return value; }
function utf8(value: string): Uint8Array { return new TextEncoder().encode(value); }
function cloneMessage(message: WireMessage): WireMessage {
  return { fields: message.fields.map((field): WireField => ({ ...field, value: field.value instanceof Uint8Array ? field.value.slice() : field.value })) };
}
function findOrderKey(field: WireField | undefined): string | undefined { return text(first(nested(field), 1)); }
function setOrderKey(field: WireField | undefined, value: string): boolean {
  const wrapper = nested(field); if (!field || !wrapper) return false;
  setText(wrapper, 1, value); field.value = encodeMessage(wrapper); return true;
}
function float32(field: WireField | undefined): number {
  return field?.wireType === 5 && field.value instanceof Uint8Array ? new DataView(field.value.buffer, field.value.byteOffset, 4).getFloat32(0, true) : 0;
}
