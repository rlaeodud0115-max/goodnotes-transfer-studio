export interface ReviewCandidate {
  sourceIndex: number | null;
  targetIndex: number | null;
  distance: number | null;
}

export function requiresPageReview(pair: ReviewCandidate, threshold = 0.25): boolean {
  return pair.sourceIndex != null
    && pair.targetIndex != null
    && pair.distance != null
    && pair.distance >= threshold;
}
