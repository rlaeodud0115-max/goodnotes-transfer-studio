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

export function requiresNoteBearingPageReview(
  pair: ReviewCandidate,
  noteBearingSources: ReadonlySet<number>,
  threshold = 0.25,
): boolean {
  return pair.sourceIndex != null
    && noteBearingSources.has(pair.sourceIndex)
    && requiresPageReview(pair, threshold);
}

export function deletedSourcePages(activeSources: Iterable<number>, mapping: ReadonlyMap<number, number>): number[] {
  const matched = new Set(mapping.keys());
  return [...new Set(activeSources)].filter((sourceIndex) => !matched.has(sourceIndex)).sort((left, right) => left - right);
}

export function reviewableDeletedSourcePages(
  deletedSources: Iterable<number>,
  noteBearingSources: ReadonlySet<number>,
): number[] {
  return [...new Set(deletedSources)]
    .filter((sourceIndex) => noteBearingSources.has(sourceIndex))
    .sort((left, right) => left - right);
}

export function availableTargetPages(targetPages: Iterable<number>, mapping: ReadonlyMap<number, number>): number[] {
  const matched = new Set(mapping.values());
  return [...new Set(targetPages)].filter((targetIndex) => !matched.has(targetIndex)).sort((left, right) => left - right);
}
