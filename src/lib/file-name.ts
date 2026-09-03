export function suggestGoodNotesOutputName(sourceName: string): string {
  const stem = sourceName.replace(/\.goodnotes$/i, "").trim() || "GoodNotes";
  return `${stem}_transferred.goodnotes`;
}

export function normalizeGoodNotesOutputName(value: string, sourceName: string): string {
  const fallback = suggestGoodNotesOutputName(sourceName);
  const cleaned = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!cleaned) return fallback;
  return /\.goodnotes$/i.test(cleaned) ? cleaned : `${cleaned}.goodnotes`;
}
