export interface ExistingPageLike {
  noteId: string;
  notePath: string;
  attachmentId?: string;
  pdfPage?: number;
}

export interface ExistingPageClassification<T extends ExistingPageLike> {
  canonicalBySource: Map<number, T>;
  blankDuplicates: T[];
  separatePages: T[];
}

/**
 * Splits the active GoodNotes sheets into one canonical sheet per source-PDF
 * page and sheets that exist separately from the source PDF. A manually added
 * page can point at a different one-page attachment, while a duplicated sheet
 * can still point at the main attachment. Both must be handled explicitly.
 */
export function classifyExistingPages<T extends ExistingPageLike>(
  pages: readonly T[],
  mainAttachmentIds: ReadonlySet<string>,
  noteLength: (page: T) => number,
): ExistingPageClassification<T> {
  const canonicalBySource = new Map<number, T>();
  const blankDuplicates: T[] = [];
  const separatePages: T[] = [];

  for (const page of pages) {
    if (!page.attachmentId || !mainAttachmentIds.has(page.attachmentId) || page.pdfPage == null) {
      separatePages.push(page);
      continue;
    }
    const sourceIndex = page.pdfPage - 1;
    const prior = canonicalBySource.get(sourceIndex);
    if (!prior) {
      canonicalBySource.set(sourceIndex, page);
      continue;
    }
    const priorHasNotes = noteLength(prior) > 0;
    const pageHasNotes = noteLength(page) > 0;
    if (priorHasNotes && !pageHasNotes) {
      blankDuplicates.push(page);
      continue;
    }
    if (priorHasNotes) separatePages.push(prior);
    else blankDuplicates.push(prior);
    canonicalBySource.set(sourceIndex, page);
  }

  return { canonicalBySource, blankDuplicates, separatePages };
}

/** Inserts retained unmatched pages at the boundary nearest their old anchors. */
export function placeKeptPagesAtOriginalBoundaries<T extends ExistingPageLike>(
  targetSlots: readonly T[],
  originalPages: readonly T[],
  keptPages: readonly T[],
  canonicalSourceByPageId: ReadonlyMap<string, number>,
  mapping: ReadonlyMap<number, number>,
  targetOrder: readonly number[],
): T[] {
  const finalPosition = new Map(targetOrder.map((target, position) => [target, position]));
  const keptIds = new Set(keptPages.map((page) => page.noteId));
  const buckets = new Map<number, T[]>();

  const mappedPosition = (page: T): number | undefined => {
    const sourceIndex = canonicalSourceByPageId.get(page.noteId);
    const targetIndex = sourceIndex == null ? undefined : mapping.get(sourceIndex);
    return targetIndex == null ? undefined : finalPosition.get(targetIndex);
  };

  for (const [originalIndex, page] of originalPages.entries()) {
    if (!keptIds.has(page.noteId)) continue;
    let boundary: number | undefined;
    for (let index = originalIndex - 1; index >= 0; index--) {
      const position = mappedPosition(originalPages[index]!);
      if (position != null) { boundary = position + 1; break; }
    }
    if (boundary == null) {
      for (let index = originalIndex + 1; index < originalPages.length; index++) {
        const position = mappedPosition(originalPages[index]!);
        if (position != null) { boundary = position; break; }
      }
    }
    boundary ??= targetSlots.length;
    const clamped = Math.max(0, Math.min(targetSlots.length, boundary));
    const bucket = buckets.get(clamped) ?? [];
    bucket.push(page);
    buckets.set(clamped, bucket);
  }

  const output: T[] = [];
  for (let position = 0; position <= targetSlots.length; position++) {
    output.push(...(buckets.get(position) ?? []));
    if (position < targetSlots.length) output.push(targetSlots[position]!);
  }
  return output;
}
