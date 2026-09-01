import { PDFDocument } from "pdf-lib";
import { createId } from "../lib/id";

export interface PdfSource {
  id: string;
  name: string;
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  dimensions: Array<{ width: number; height: number }>;
}

export interface PdfPageItem {
  id: string;
  sourceId: string;
  sourceName: string;
  pageIndex: number;
  selected: boolean;
}

export class PdfWorkspace {
  readonly sources = new Map<string, PdfSource>();
  pages: PdfPageItem[] = [];

  async addFiles(files: Iterable<File>): Promise<PdfSource[]> {
    const added: PdfSource[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error(`${file.name}: PDF 파일이 아닙니다.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let document: PDFDocument;
      try {
        document = await PDFDocument.load(bytes, { updateMetadata: false });
      } catch (error) {
        throw new Error(`${file.name}: 암호화되었거나 손상된 PDF입니다.`, { cause: error });
      }
      const id = createId("pdf");
      const source: PdfSource = {
        id,
        name: file.name,
        file,
        bytes,
        pageCount: document.getPageCount(),
        dimensions: document.getPages().map((page) => page.getSize()),
      };
      this.sources.set(id, source);
      this.pages.push(...Array.from({ length: source.pageCount }, (_, pageIndex) => ({
        id: `${id}:${pageIndex}`,
        sourceId: id,
        sourceName: file.name,
        pageIndex,
        selected: true,
      })));
      added.push(source);
    }
    return added;
  }

  reorder(oldIndex: number, newIndex: number): void {
    if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0) return;
    const [moved] = this.pages.splice(oldIndex, 1);
    if (moved) this.pages.splice(newIndex, 0, moved);
  }

  toggle(pageId: string): void {
    const page = this.pages.find((candidate) => candidate.id === pageId);
    if (page) page.selected = !page.selected;
  }

  clear(): void {
    this.sources.clear();
    this.pages = [];
  }

  async merge(): Promise<Uint8Array> {
    const selected = this.pages.filter((page) => page.selected);
    if (!selected.length) throw new Error("합칠 페이지를 한 장 이상 선택해 주세요.");
    const output = await PDFDocument.create();
    const loaded = new Map<string, PDFDocument>();
    for (const page of selected) {
      let source = loaded.get(page.sourceId);
      if (!source) {
        const item = this.sources.get(page.sourceId);
        if (!item) throw new Error("원본 PDF를 찾을 수 없습니다.");
        source = await PDFDocument.load(item.bytes, { updateMetadata: false });
        loaded.set(page.sourceId, source);
      }
      const [copied] = await output.copyPages(source, [page.pageIndex]);
      if (!copied) throw new Error(`${page.sourceName} ${page.pageIndex + 1}쪽을 복사하지 못했습니다.`);
      output.addPage(copied);
    }
    output.setProducer("GoodNotes Transfer Studio");
    return output.save({ useObjectStreams: true, addDefaultPage: false });
  }
}
