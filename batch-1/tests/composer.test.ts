import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { PdfWorkspace } from "../src/pdf/composer";

async function pdfFile(name: string, widths: number[]): Promise<File> {
  const pdf = await PDFDocument.create();
  widths.forEach((width) => pdf.addPage([width, 500]));
  const bytes = await pdf.save();
  return new File([bytes.buffer as ArrayBuffer], name, { type: "application/pdf" });
}

describe("PDF composer", () => {
  it("uses the dragged page order and excludes unselected pages", async () => {
    const workspace = new PdfWorkspace();
    await workspace.addFiles([await pdfFile("a.pdf", [300, 310]), await pdfFile("b.pdf", [400])]);
    workspace.reorder(2, 0);
    workspace.toggle(workspace.pages[2]!.id);
    const output = await PDFDocument.load(await workspace.merge());
    expect(output.getPages().map((page) => page.getWidth())).toEqual([400, 300]);
  });
});
