import { describe, expect, it } from "vitest";
import { invalidateAttachmentSearch, uuidKey } from "../src/goodnotes/model";
import { decodeDelimited, encodeDelimited, first, text, type WireMessage } from "../src/goodnotes/wire";

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

function searchRecord(id: string, path: string, kind: number): WireMessage {
  return { fields: [
    { number: 1, wireType: 2, value: utf8(id) },
    { number: 2, wireType: 2, value: utf8(path) },
    { number: 3, wireType: 0, value: BigInt(kind) },
  ] };
}

describe("GoodNotes UUID pairing", () => {
  it("uses the legacy UUID prefix to link event and note revisions", () => {
    const eventId = "3564A3B6-E6E3-5FAA-A240-DAC6667AADE0";
    const noteId = "3564A3B6-E6E3-5FAA-A240-DAC6667AADE1";
    const differentPage = "3564A3B6-E6E3-5FAA-A240-DAC6667A1231";

    expect(uuidKey(eventId)).toBe(uuidKey(noteId));
    expect(uuidKey(noteId)).toBe(uuidKey(differentPage));
  });
});

describe("GoodNotes search cache invalidation", () => {
  it("removes only the replaced PDF attachment cache", () => {
    const attachmentId = "PDF-ATTACHMENT";
    const noteId = "HANDWRITING-NOTE";
    const attachmentPath = `search/${attachmentId}`;
    const notePath = `search/${noteId}`;
    const entries: Record<string, Uint8Array> = {
      "index.search.pb": encodeDelimited([
        searchRecord(attachmentId, attachmentPath, 1),
        searchRecord(noteId, notePath, 2),
      ]),
      [attachmentPath]: Uint8Array.of(1, 2, 3),
      [notePath]: Uint8Array.of(4, 5, 6),
    };

    expect(invalidateAttachmentSearch(entries, new Set([attachmentId]))).toBe(1);

    const remaining = decodeDelimited(entries["index.search.pb"]!);
    expect(remaining).toHaveLength(1);
    expect(text(first(remaining[0], 1))).toBe(noteId);
    expect(entries[attachmentPath]).toBeUndefined();
    expect(entries[notePath]).toEqual(Uint8Array.of(4, 5, 6));
  });
});
