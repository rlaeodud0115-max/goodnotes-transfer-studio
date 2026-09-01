import { describe, expect, it } from "vitest";
import { uuidKey } from "../src/goodnotes/model";

describe("GoodNotes UUID pairing", () => {
  it("uses the legacy UUID prefix to link event and note revisions", () => {
    const eventId = "3564A3B6-E6E3-5FAA-A240-DAC6667AADE0";
    const noteId = "3564A3B6-E6E3-5FAA-A240-DAC6667AADE1";
    const differentPage = "3564A3B6-E6E3-5FAA-A240-DAC6667A1231";

    expect(uuidKey(eventId)).toBe(uuidKey(noteId));
    expect(uuidKey(noteId)).toBe(uuidKey(differentPage));
  });
});
