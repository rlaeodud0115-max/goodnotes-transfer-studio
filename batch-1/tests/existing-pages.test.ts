import { describe, expect, it } from "vitest";
import { classifyExistingPages, placeKeptPagesAtOriginalBoundaries, type ExistingPageLike } from "../src/goodnotes/existing-pages";

interface Page extends ExistingPageLike { notes: number }

const page = (noteId: string, pdfPage: number | undefined, notes = 0, attachmentId = "main"): Page => ({
  noteId, notePath: `notes/${noteId}`, attachmentId, pdfPage, notes,
});

describe("existing GoodNotes pages", () => {
  it("separates manually added pages from canonical PDF sheets", () => {
    const pages = [page("one", 1), page("two", 2), page("manual-a", 1, 10, "blank"), page("manual-b", 1, 8, "blank")];
    const result = classifyExistingPages(pages, new Set(["main"]), (item) => item.notes);

    expect([...result.canonicalBySource.keys()]).toEqual([0, 1]);
    expect(result.separatePages.map((item) => item.noteId)).toEqual(["manual-a", "manual-b"]);
  });

  it("retains unmatched pages beside their nearest original mapped anchor", () => {
    const one = page("one", 1), manualA = page("manual-a", 1, 10, "blank");
    const manualB = page("manual-b", 1, 8, "blank"), two = page("two", 2);
    const targetOne = page("target-one", 1), targetTwo = page("target-two", 2);
    const output = placeKeptPagesAtOriginalBoundaries(
      [targetOne, targetTwo],
      [one, manualA, manualB, two],
      [manualA, manualB],
      new Map([[one.noteId, 0], [two.noteId, 1]]),
      new Map([[0, 0], [1, 1]]),
      [0, 1],
    );

    expect(output.map((item) => item.noteId)).toEqual(["target-one", "manual-a", "manual-b", "target-two"]);
  });
});
