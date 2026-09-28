import { describe, expect, it } from "vitest";
import { normalizeGoodNotesOutputName, suggestGoodNotesOutputName } from "../src/lib/file-name";

describe("GoodNotes output file names", () => {
  it("suggests a transferred name from the source", () => {
    expect(suggestGoodNotesOutputName("강의.goodnotes")).toBe("강의_transferred.goodnotes");
  });

  it("adds the extension and replaces path characters", () => {
    expect(normalizeGoodNotesOutputName("새/강의:완성본", "원본.goodnotes"))
      .toBe("새_강의_완성본.goodnotes");
  });

  it("falls back to the suggested name when blank", () => {
    expect(normalizeGoodNotesOutputName("   ", "원본.goodnotes"))
      .toBe("원본_transferred.goodnotes");
  });
});
