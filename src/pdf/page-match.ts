import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

const GRID = 16;
const GAP_COST = 0.35;
const EMPTY_DISTANCE = 1.6;
const ASPECT_WEIGHT = 0.35;

export interface InkBox { x0: number; y0: number; x1: number; y1: number; width: number; height: number }
export interface PageFingerprint {
  index: number;
  cells: number[];
  fullCells: number[];
  edgeCells: number[];
  aspect: number;
  text: string;
  box?: InkBox;
}
export interface PagePair {
  sourceIndex: number | null;
  targetIndex: number | null;
  distance: number | null;
  margin: number | null;
}
export interface MatchResult {
  pairs: PagePair[];
  sourceOnly: number[];
  targetOnly: number[];
  mapping: Map<number, number>;
}
export interface PageAlignment {
  scale: number;
  offsetX: number;
  offsetY: number;
  axesAgree: boolean;
  improves: boolean;
}

export type ProgressCallback = (message: string, completed: number, total: number) => void;

export async function fingerprintPdf(bytes: Uint8Array, onProgress?: ProgressCallback, label = "PDF"): Promise<PageFingerprint[]> {
  const task = getDocument({ data: bytes.slice() });
  const document = await task.promise;
  try {
    const output: PageFingerprint[] = [];
    for (let index = 0; index < document.numPages; index++) {
      onProgress?.(`${label} ${index + 1}/${document.numPages}쪽 분석`, index, document.numPages);
      output.push(await fingerprintPage(document, index));
    }
    onProgress?.(`${label} 분석 완료`, document.numPages, document.numPages);
    return output;
  } finally {
    await document.destroy();
  }
}

async function fingerprintPage(document: PDFDocumentProxy, index: number): Promise<PageFingerprint> {
  const page = await document.getPage(index + 1);
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 180 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = documentOwnerCanvas(Math.max(2, Math.ceil(viewport.width)), Math.max(2, Math.ceil(viewport.height)));
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) throw new Error("PDF 분석 화면을 만들 수 없습니다.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const visual = (() => {
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let pixel = 0, offset = 0; pixel < gray.length; pixel++, offset += 4) {
      gray[pixel] = Math.round(0.299 * (rgba[offset] ?? 255) + 0.587 * (rgba[offset + 1] ?? 255) + 0.114 * (rgba[offset + 2] ?? 255));
    }
    const pixelBox = findInkBox(gray, canvas.width, canvas.height);
    const fullCells = normalize(sampleGrid(gray, canvas.width, canvas.height, { left: 0, top: 0, right: canvas.width, bottom: canvas.height }));
    const edgeCells = normalizeEdges(fullCells);
    let cells: number[] = [];
    let aspect = 1;
    let box: InkBox | undefined;
    if (pixelBox) {
      cells = normalize(sampleGrid(gray, canvas.width, canvas.height, pixelBox));
      aspect = (pixelBox.right - pixelBox.left) / Math.max(1, pixelBox.bottom - pixelBox.top);
      box = {
        x0: pixelBox.left / scale, y0: pixelBox.top / scale,
        x1: pixelBox.right / scale, y1: pixelBox.bottom / scale,
        width: (pixelBox.right - pixelBox.left) / scale,
        height: (pixelBox.bottom - pixelBox.top) / scale,
      };
    }
    return { cells, fullCells, edgeCells, aspect, box };
  })();
  // Release the GPU-backed canvas before text extraction and the next page.
  canvas.width = 1;
  canvas.height = 1;
  let content = "";
  try {
    const textContent = await page.getTextContent();
    content = normalizeText(textContent.items.map((item) => "str" in item ? item.str : "").join(" "));
  } catch { /* Image-only pages intentionally have no text fingerprint. */ }
  page.cleanup();
  return { index, ...visual, text: content };
}

function findInkBox(gray: Uint8Array, width: number, height: number) {
  const corners = [gray[0] ?? 255, gray[width - 1] ?? 255, gray[(height - 1) * width] ?? 255, gray[height * width - 1] ?? 255].sort((a, b) => a - b);
  const background = corners[1] ?? 255;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (Math.abs((gray[y * width + x] ?? background) - background) <= 7) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < left ? undefined : { left, top, right: right + 1, bottom: bottom + 1 };
}

function sampleGrid(gray: Uint8Array, width: number, height: number, box: { left: number; top: number; right: number; bottom: number }): number[] {
  const output: number[] = [];
  for (let row = 0; row < GRID; row++) {
    const top = Math.floor(box.top + row * (box.bottom - box.top) / GRID);
    const bottom = Math.max(top + 1, Math.floor(box.top + (row + 1) * (box.bottom - box.top) / GRID));
    for (let column = 0; column < GRID; column++) {
      const left = Math.floor(box.left + column * (box.right - box.left) / GRID);
      const right = Math.max(left + 1, Math.floor(box.left + (column + 1) * (box.right - box.left) / GRID));
      let sum = 0, count = 0;
      for (let y = top; y < Math.min(height, bottom); y++) for (let x = left; x < Math.min(width, right); x++) {
        sum += gray[y * width + x] ?? 255; count++;
      }
      output.push(count ? sum / count : 255);
    }
  }
  return output;
}

function normalize(values: number[]): number[] {
  if (!values.length) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const spread = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length) || 1;
  return values.map((value) => (value - mean) / spread);
}

function normalizeEdges(cells: number[]): number[] {
  if (cells.length !== GRID * GRID) return [];
  const edges: number[] = [];
  for (let row = 0; row < GRID; row++) for (let column = 0; column < GRID; column++) {
    const here = cells[row * GRID + column] ?? 0;
    const right = cells[row * GRID + Math.min(GRID - 1, column + 1)] ?? 0;
    const down = cells[Math.min(GRID - 1, row + 1) * GRID + column] ?? 0;
    edges.push(Math.abs(here - right) + Math.abs(here - down));
  }
  return normalize(edges);
}

function normalizeText(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().match(/[0-9a-z가-힣]+/g)?.join(" ") ?? "";
}

function dice(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const item of left) if (right.has(item)) common++;
  return 2 * common / (left.size + right.size);
}

interface TextFeatures { usable: boolean; tokens: Set<string>; grams: Set<string> }

function prepareText(value: string): TextFeatures {
  const words = value.split(" ").filter(Boolean);
  const compact = words.join("");
  if (compact.length < 16 || words.length < 3) return { usable: false, tokens: new Set(), grams: new Set() };
  const grams = new Set<string>();
  for (let index = 0; index < compact.length - 2; index++) grams.add(compact.slice(index, index + 3));
  return { usable: true, tokens: new Set(words), grams };
}

function textSimilarityFromFeatures(left: TextFeatures, right: TextFeatures): number | null {
  if (!left.usable || !right.usable) return null;
  return 0.6 * dice(left.tokens, right.tokens) + 0.4 * dice(left.grams, right.grams);
}

export function fingerprintDistance(left: PageFingerprint, right: PageFingerprint): number {
  return fingerprintDistancePrepared(left, right, prepareText(left.text), prepareText(right.text));
}

function fingerprintDistancePrepared(
  left: PageFingerprint,
  right: PageFingerprint,
  leftText: TextFeatures,
  rightText: TextFeatures,
): number {
  let visual: number;
  if (!left.cells.length || !right.cells.length) visual = !left.cells.length && !right.cells.length ? 0 : EMPTY_DISTANCE;
  else {
    visual = left.cells.reduce((sum, value, index) => sum + Math.abs(value - (right.cells[index] ?? 0)), 0) / left.cells.length;
    visual += ASPECT_WEIGHT * Math.abs(Math.log(left.aspect / Math.max(right.aspect, 1e-9)));
    if (left.fullCells.length && right.fullCells.length) {
      const full = left.fullCells.reduce((sum, value, index) => sum + Math.abs(value - (right.fullCells[index] ?? 0)), 0) / left.fullCells.length;
      visual = 0.78 * visual + 0.14 * full;
      const edge = left.edgeCells.reduce((sum, value, index) => sum + Math.abs(value - (right.edgeCells[index] ?? 0)), 0) / Math.max(1, left.edgeCells.length);
      visual += 0.08 * edge;
    }
  }
  const similarity = textSimilarityFromFeatures(leftText, rightText);
  if (similarity == null) return visual;
  const hybrid = 0.55 * Math.min(visual, 1.2) + 0.60 * (1 - similarity);
  return similarity >= 0.82 ? Math.min(hybrid, 1.5 * (1 - similarity)) : hybrid;
}

export function matchFingerprints(source: PageFingerprint[], target: PageFingerprint[]): MatchResult {
  if (source.length * target.length > 400_000) throw new Error(`페이지가 너무 많습니다: ${source.length} × ${target.length}`);
  const sourceText = source.map((page) => prepareText(page.text));
  const targetText = target.map((page) => prepareText(page.text));
  const matrix = source.map((left, row) => target.map((right, column) =>
    fingerprintDistancePrepared(left, right, sourceText[row]!, targetText[column]!)));
  return matchFromMatrix(matrix, source.length, target.length);
}

export async function matchFingerprintsAsync(
  source: PageFingerprint[],
  target: PageFingerprint[],
  onProgress?: (completed: number, total: number) => void,
): Promise<MatchResult> {
  const total = source.length * target.length;
  if (total > 400_000) throw new Error(`페이지가 너무 많습니다: ${source.length} × ${target.length}`);
  // iPad Safari must periodically regain the main thread or it can terminate a
  // long calculation as an unresponsive page. Text features are still reused.
  const sourceText = source.map((page) => prepareText(page.text));
  const targetText = target.map((page) => prepareText(page.text));
  const matrix: number[][] = Array.from({ length: source.length }, () => []);
  let completed = 0;
  let lastYield = performance.now();
  for (let row = 0; row < source.length; row++) {
    const values = matrix[row]!;
    for (let column = 0; column < target.length; column++) {
      values.push(fingerprintDistancePrepared(source[row]!, target[column]!, sourceText[row]!, targetText[column]!));
      completed++;
      if (performance.now() - lastYield >= 12) {
        onProgress?.(completed, total);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
  }
  onProgress?.(total, total);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return matchFromMatrix(matrix, source.length, target.length);
}

function matchFromMatrix(matrix: number[][], rows: number, columns: number): MatchResult {
  const cost = Array.from({ length: rows + 1 }, () => new Float64Array(columns + 1));
  const choice = Array.from({ length: rows + 1 }, () => new Uint8Array(columns + 1));
  for (let i = 1; i <= rows; i++) { cost[i]![0] = i * GAP_COST; choice[i]![0] = 1; }
  for (let j = 1; j <= columns; j++) { cost[0]![j] = j * GAP_COST; choice[0]![j] = 2; }
  for (let i = 1; i <= rows; i++) for (let j = 1; j <= columns; j++) {
    const match = cost[i - 1]![j - 1]! + matrix[i - 1]![j - 1]!;
    const skipSource = cost[i - 1]![j]! + GAP_COST;
    const skipTarget = cost[i]![j - 1]! + GAP_COST;
    if (match <= skipSource && match <= skipTarget) { cost[i]![j] = match; choice[i]![j] = 0; }
    else if (skipSource <= skipTarget) { cost[i]![j] = skipSource; choice[i]![j] = 1; }
    else { cost[i]![j] = skipTarget; choice[i]![j] = 2; }
  }
  const pairs: PagePair[] = [];
  let i = rows, j = columns;
  while (i || j) {
    const selected = i && j ? choice[i]![j] : i ? 1 : 2;
    if (selected === 0) {
      const distance = matrix[i - 1]![j - 1]!;
      let competitor = Infinity;
      for (let column = 0; column < columns; column++) if (column !== j - 1) competitor = Math.min(competitor, matrix[i - 1]![column]!);
      for (let row = 0; row < rows; row++) if (row !== i - 1) competitor = Math.min(competitor, matrix[row]![j - 1]!);
      pairs.push({ sourceIndex: i - 1, targetIndex: j - 1, distance, margin: Number.isFinite(competitor) ? competitor - distance : null });
      i--; j--;
    } else if (selected === 1) { pairs.push({ sourceIndex: --i, targetIndex: null, distance: null, margin: null }); }
    else { pairs.push({ sourceIndex: null, targetIndex: --j, distance: null, margin: null }); }
  }
  pairs.reverse();
  const mapping = new Map<number, number>();
  for (const pair of pairs) if (pair.sourceIndex != null && pair.targetIndex != null) mapping.set(pair.sourceIndex, pair.targetIndex);
  return {
    pairs,
    sourceOnly: pairs.flatMap((pair) => pair.sourceIndex != null && pair.targetIndex == null ? [pair.sourceIndex] : []),
    targetOnly: pairs.flatMap((pair) => pair.targetIndex != null && pair.sourceIndex == null ? [pair.targetIndex] : []),
    mapping,
  };
}

export function estimateAlignment(source: PageFingerprint[], target: PageFingerprint[], match: MatchResult): PageAlignment | null {
  let pairs = match.pairs.filter((pair) => pair.sourceIndex != null && pair.targetIndex != null);
  if (pairs.length > 12) pairs = Array.from({ length: 12 }, (_, index) => pairs[Math.round(index * (pairs.length - 1) / 11)]!).filter(Boolean);
  const boxes = pairs.flatMap((pair) => {
    const oldBox = source[pair.sourceIndex!]?.box, newBox = target[pair.targetIndex!]?.box;
    return oldBox && newBox && Math.min(oldBox.width, oldBox.height, newBox.width, newBox.height) >= 1 ? [{ oldBox, newBox }] : [];
  });
  if (boxes.length < 2) return null;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const scale = median(boxes.map(({ oldBox, newBox }) => oldBox.width / newBox.width));
  const aspectScale = median(boxes.map(({ oldBox, newBox }) => oldBox.height / newBox.height));
  const offsetX = median(boxes.map(({ oldBox, newBox }) => oldBox.x0 - scale * newBox.x0));
  const offsetY = median(boxes.map(({ oldBox, newBox }) => oldBox.y0 - scale * newBox.y0));
  let residual = 0, identityResidual = 0;
  for (const { oldBox, newBox } of boxes) {
    residual = Math.max(residual,
      Math.abs(offsetX + scale * newBox.x0 - oldBox.x0), Math.abs(offsetY + scale * newBox.y0 - oldBox.y0),
      Math.abs(offsetX + scale * newBox.x1 - oldBox.x1), Math.abs(offsetY + scale * newBox.y1 - oldBox.y1));
    identityResidual = Math.max(identityResidual,
      Math.abs(newBox.x0 - oldBox.x0), Math.abs(newBox.y0 - oldBox.y0),
      Math.abs(newBox.x1 - oldBox.x1), Math.abs(newBox.y1 - oldBox.y1));
  }
  return {
    scale, offsetX, offsetY,
    axesAgree: Math.abs(aspectScale - scale) <= 0.005 * Math.max(scale, 1e-9),
    improves: identityResidual > 2 && residual <= 0.5 * identityResidual,
  };
}

function documentOwnerCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; return canvas;
}
