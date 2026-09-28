import { describe, expect, it } from "vitest";
import { availableTargetPages, deletedSourcePages, requiresNoteBearingPageReview, requiresPageReview, reviewableDeletedSourcePages, type ReviewCandidate } from "../src/pdf/review-policy";
import { fingerprintDistance, matchFingerprints, type PageFingerprint } from "../src/pdf/page-match";

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

  it("skips ambiguous matching when the source page has no notes", () => {
    expect(requiresNoteBearingPageReview(pair(0.4), new Set())).toBe(false);
    expect(requiresNoteBearingPageReview(pair(0.4), new Set([0]))).toBe(true);
  });
});

describe("manual recovery candidates", () => {
  const mapping = new Map([[0, 0], [2, 3]]);

  it("shows every active source page that is currently unmatched", () => {
    expect(deletedSourcePages([0, 1, 2, 4], mapping)).toEqual([1, 4]);
  });

  it("offers only revised pages that are not already matched", () => {
    expect(availableTargetPages([0, 1, 2, 3, 4], mapping)).toEqual([1, 2, 4]);
  });

  it("asks for manual recovery only when the deleted source page has notes", () => {
    expect(reviewableDeletedSourcePages([1, 4, 7], new Set([4, 7]))).toEqual([4, 7]);
  });
});

describe("device-independent text matching", () => {
  const fingerprint = (text: string, cells: number[]): PageFingerprint => ({
    index: 0,
    text,
    cells,
    fullCells: cells,
    edgeCells: cells,
    aspect: 1,
  });

  it("uses matching PDF text even when raster pixels differ by device", () => {
    const source = fingerprint("edema effusions hyperemia congestion hemorrhage", [8, -5, 3, 2]);
    const target = fingerprint("edema effusions hyperemia congestion hemorrhage", [-8, 5, -3, -2]);
    expect(fingerprintDistance(source, target)).toBeLessThan(0.25);
  });

  it("tolerates different PDF text-operation boundaries", () => {
    const source = fingerprint("platelet adhesion and coagulation cascade", [0]);
    const target = fingerprint("plateletadhesionandcoagulationcascade", [0]);
    expect(fingerprintDistance(source, target)).toBeLessThan(0.25);
  });
});

describe("position-anchored replacement matching", () => {
  const fingerprint = (index: number, cells: number[]): PageFingerprint => ({
    index,
    text: "",
    cells,
    fullCells: cells,
    edgeCells: cells,
    aspect: 1,
  });
  const same = (index: number) => fingerprint(index, [index, index + 1, index + 2, index + 3]);
  const oldDesign = (index: number) => fingerprint(index, [12, -12, 12, -12]);
  const newDesign = (index: number) => fingerprint(index, [-12, 12, -12, 12]);

  it("recovers redesigned pages before the first unchanged anchor", () => {
    const source = [oldDesign(0), oldDesign(1), same(2), same(3)];
    const target = [newDesign(0), newDesign(1), same(2), same(3)];
    expect([...matchFingerprints(source, target).mapping.entries()]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it("recovers redesigned pages after the last unchanged anchor", () => {
    const source = [same(0), same(1), oldDesign(2), oldDesign(3)];
    const target = [same(0), same(1), newDesign(2), newDesign(3)];
    expect([...matchFingerprints(source, target).mapping.entries()]).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it("does not map an old-only trailing page to an arbitrary revised page", () => {
    const source = [same(0), same(1), oldDesign(2)];
    const target = [same(0), same(1)];
    const result = matchFingerprints(source, target);
    expect([...result.mapping.entries()]).toEqual([[0, 0], [1, 1]]);
    expect(result.sourceOnly).toEqual([2]);
  });
});
