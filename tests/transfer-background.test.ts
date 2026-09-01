import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildNormalizedPdf } from "../src/goodnotes/background";

async function pdfBytes(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const [index, size] of sizes.entries()) document.addPage(size).drawText(`page ${index + 1}`);
  return document.save();
}

describe("GoodNotes revised background", () => {
  it("keeps mapped pages on the old canvas and preserves each added PDF page size", async () => {
    const source = await pdfBytes([[720, 405]]);
    const revised = await pdfBytes([[720, 405], [720, 540], [612, 792]]);
    const result = await buildNormalizedPdf(source, revised, [0, 1, 2], new Map([[0, 0]]), [], null);
    const output = await PDFDocument.load(result.bytes);

    expect(output.getPages().map((page) => page.getSize())).toEqual([
      { width: 720, height: 405 },
      { width: 720, height: 540 },
      { width: 612, height: 792 },
    ]);
    expect(result.pageSizes).toEqual([
      { width: 720, height: 405 },
      { width: 720, height: 540 },
      { width: 612, height: 792 },
    ]);
  });
});
