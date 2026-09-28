import { describe, expect, it } from "vitest";
import { decodeDelimited, encodeDelimited, type WireMessage } from "../src/goodnotes/wire";

describe("GoodNotes protobuf wire codec", () => {
  it("round-trips unknown fields without changing their values", () => {
    const messages: WireMessage[] = [{ fields: [
      { number: 1, wireType: 0, value: 35n },
      { number: 2, wireType: 2, value: new TextEncoder().encode("페이지") },
      { number: 10, wireType: 1, value: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) },
    ] }];
    expect(decodeDelimited(encodeDelimited(messages))).toEqual(messages);
  });
});
