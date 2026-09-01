import { describe, expect, it } from "vitest";
import { requiresPageReview, type ReviewCandidate } from "../src/pdf/review-policy";

const pair = (distance: number | null): ReviewCandidate => ({
  sourceIndex: 0,
  targetIndex: 0,
  distance,
});

describe("page review policy", () => {
  it("automatically accepts distances below 0.25", () => {
    expect(requiresPageReview(pair(0))).toBe(false);
    expect(requiresPageReview(pair(0.249999))).toBe(false);
  });

  it("asks for confirmation from exactly 0.25", () => {
    expect(requiresPageReview(pair(0.25))).toBe(true);
    expect(requiresPageReview(pair(0.8))).toBe(true);
  });
});
