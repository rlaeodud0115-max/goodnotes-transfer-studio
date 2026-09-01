import { describe, expect, it } from "vitest";
import { requiresPageReview, type ReviewCandidate } from "../src/pdf/review-policy";
import { fingerprintDistance, type PageFingerprint } from "../src/pdf/page-match";

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
