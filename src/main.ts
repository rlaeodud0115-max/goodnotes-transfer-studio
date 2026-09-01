import "./styles.css";
import "./review.css";
import { PdfWorkspace, type PdfPageItem, type PdfSource } from "./pdf/composer";
import { renderThumbnail, releasePdfPreviews } from "./pdf/thumbnail";
import { PageBoard, type BoardPage } from "./ui/page-board";
import { saveFile } from "./lib/save-file";
import { GoogleDriveClient } from "./drive/google-drive";
import { inspectGoodNotes, type GoodNotesInspection } from "./goodnotes/archive";
import { fingerprintPdf, matchFingerprints, type MatchResult } from "./pdf/page-match";
import type { PageFingerprint, PagePair } from "./pdf/page-match";
import { transferGoodNotes } from "./goodnotes/transfer";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div class="brand"><span class="brand-mark">GN</span><div><strong>GoodNotes Transfer Studio</strong><small>기기에서 안전하게 처리</small></div></div>
    <div class="header-actions"><button id="installButton" class="quiet" hidden>앱 설치</button><button id="driveSettingsButton" class="quiet">Google Drive 설정</button></div>
  </header>
  <main>
    <section class="hero">
      <span class="eyebrow">MAC · IPAD · OFFLINE READY</span>
      <h1>강의록을 합치고,<br>필기는 그대로 옮기세요.</h1>
      <p>문서는 서버에 업로드하지 않고 이 기기 안에서 처리합니다. 전체 페이지 구성표는 필요할 때만 열 수 있습니다.</p>
    </section>
    <nav class="tabs" aria-label="작업 선택">
      <button class="tab active" data-tab="transfer">GoodNotes 옮기기</button>
      <button class="tab" data-tab="merge">PDF 합치기</button>
    </nav>

    <section id="transferPanel" class="panel active">
      <div class="panel-heading"><div><span class="step-label">GOODNOTES</span><h2>수정 강의록에 기존 필기 옮기기</h2></div></div>
      <div class="file-grid">
        <label class="file-card"><span class="file-number">1</span><strong>기존 GoodNotes 문서</strong><small id="goodnotesName">.goodnotes 파일 선택</small><input id="goodnotesInput" type="file" accept=".goodnotes" /></label>
        <label class="file-card"><span class="file-number">2</span><strong>수정된 강의록 PDF</strong><small id="revisedName">.pdf 파일 선택</small><input id="revisedInput" type="file" accept="application/pdf,.pdf" /></label>
      </div>
      <div class="row-actions"><button id="transferDriveButton" class="secondary">Google Drive에서 선택</button><button id="analyzeTransferButton" class="primary" disabled>페이지 분석하기</button></div>
      <div id="transferStatus" class="status" aria-live="polite"></div>
      <section id="transferResult" class="result" hidden>
        <div class="metrics">
          <div><span>활성 GoodNotes 페이지</span><strong id="activePages">-</strong></div>
          <div><span>기존 배경 PDF</span><strong id="sourcePages">-</strong></div>
          <div><span>수정 PDF</span><strong id="targetPages">-</strong></div>
          <div><span>문서 형식</span><strong id="formatVersion">-</strong></div>
        </div>
        <section id="transferReviewsSection" class="transfer-reviews" hidden>
          <div class="section-heading"><strong>수정된 페이지 확인</strong><small id="reviewProgress"></small></div>
          <div id="transferReviews"></div>
        </section>
        <details id="transferMapDetails" class="page-map-details">
          <summary><span><strong>전체 페이지 구성표</strong><small>원할 때 열어 페이지 순서를 확인·변경하세요.</small></span><span class="summary-action">펼치기</span></summary>
          <div class="map-help">손잡이 <b>⠿</b>를 잡고 드래그하세요. iPad에서는 손잡이를 잠깐 누른 뒤 이동하면 됩니다.</div>
          <div id="transferPageBoard" class="page-board"></div>
        </details>
        <div class="row-actions"><button id="createGoodnotesButton" class="primary" disabled>기기에 GoodNotes 저장</button><button id="createGoodnotesDriveButton" class="secondary" disabled>Google Drive에 저장</button></div>
      </section>
    </section>

    <section id="mergePanel" class="panel">
      <div class="panel-heading"><div><span class="step-label">PDF COMPOSER</span><h2>여러 PDF에서 필요한 페이지 합치기</h2></div></div>
      <label class="merge-drop"><strong>PDF 추가</strong><small>여러 파일을 한 번에 선택할 수 있습니다.</small><input id="mergeInput" type="file" accept="application/pdf,.pdf" multiple /></label>
      <div class="row-actions"><button id="mergeDriveButton" class="secondary">Google Drive에서 추가</button><button id="clearMergeButton" class="quiet">모두 비우기</button></div>
      <div id="mergeStatus" class="status" aria-live="polite"></div>
      <section id="mergeWorkspace" hidden>
        <div class="board-toolbar"><div><strong id="mergeCount">0쪽</strong><small>페이지를 눌러 포함·제외하고, ⠿ 손잡이로 순서를 바꾸세요.</small></div><input id="mergeOutputName" value="합친-강의록.pdf" aria-label="저장할 PDF 이름" /></div>
        <div id="mergePageBoard" class="page-board"></div>
        <div class="row-actions sticky-actions"><button id="mergeSaveButton" class="primary">기기에 PDF 저장</button><button id="mergeDriveSaveButton" class="secondary">Google Drive에 저장</button></div>
      </section>
    </section>
  </main>

  <dialog id="driveDialog">
    <form method="dialog" class="dialog-card">
      <div class="dialog-head"><div><strong>Google Drive 연결 설정</strong><small>Google Cloud에서 발급한 웹 앱 키를 이 기기에만 저장합니다.</small></div><button value="cancel" class="icon-button" aria-label="닫기">✕</button></div>
      <label>OAuth Client ID<input id="googleClientId" autocomplete="off" placeholder="000000000000-….apps.googleusercontent.com" /></label>
      <label>Google Picker API Key<input id="googleApiKey" autocomplete="off" placeholder="AIza…" /></label>
      <p class="dialog-help">승인된 JavaScript 원본에 이 앱의 주소를 등록해야 합니다. 키는 브라우저의 로컬 저장소에만 보관됩니다.</p>
      <button id="saveDriveSettings" value="default" class="primary">저장</button>
    </form>
  </dialog>
`;

const mergeWorkspace = new PdfWorkspace();
const revisedWorkspace = new PdfWorkspace();
const drive = new GoogleDriveClient();
let mergeBoard: PageBoard | null = null;
let transferBoard: PageBoard | null = null;
let goodnotesFile: File | null = null;
let revisedFile: File | null = null;
let inspection: GoodNotesInspection | null = null;
let transferOrder: PdfPageItem[] = [];
let transferMatch: MatchResult | null = null;
let transferStatuses = new Map<number, "kept" | "added" | "review">();
let sourceFingerprints: PageFingerprint[] = [];
let targetFingerprints: PageFingerprint[] = [];
let reviewPairs: PagePair[] = [];
let reviewDecisions = new Map<string, "same" | "different">();
let pendingInstall: Event & { prompt(): Promise<void> } | null = null;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (id: string, message = "", type: "" | "working" | "error" | "success" = "") => {
  const element = byId<HTMLDivElement>(id);
  element.textContent = message;
  element.className = `status ${message ? "show" : ""} ${type}`;
};

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
  byId("transferPanel").classList.toggle("active", button.dataset.tab === "transfer");
  byId("mergePanel").classList.toggle("active", button.dataset.tab === "merge");
}));

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pendingInstall = event as typeof pendingInstall;
  byId<HTMLButtonElement>("installButton").hidden = false;
});
byId("installButton").addEventListener("click", async () => pendingInstall?.prompt());

const driveDialog = byId<HTMLDialogElement>("driveDialog");
byId("driveSettingsButton").addEventListener("click", () => {
  byId<HTMLInputElement>("googleClientId").value = drive.config.clientId;
  byId<HTMLInputElement>("googleApiKey").value = drive.config.apiKey;
  driveDialog.showModal();
});
byId("saveDriveSettings").addEventListener("click", () => drive.saveConfig({
  clientId: byId<HTMLInputElement>("googleClientId").value.trim(),
  apiKey: byId<HTMLInputElement>("googleApiKey").value.trim(),
}));

byId<HTMLInputElement>("goodnotesInput").addEventListener("change", (event) => {
  goodnotesFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  byId("goodnotesName").textContent = goodnotesFile?.name ?? ".goodnotes 파일 선택";
  syncTransferReady();
});
byId<HTMLInputElement>("revisedInput").addEventListener("change", (event) => {
  revisedFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  byId("revisedName").textContent = revisedFile?.name ?? ".pdf 파일 선택";
  syncTransferReady();
});

function syncTransferReady(): void {
  byId<HTMLButtonElement>("analyzeTransferButton").disabled = !(goodnotesFile && revisedFile);
  byId("transferResult").hidden = true;
}

byId("analyzeTransferButton").addEventListener("click", async () => {
  if (!goodnotesFile || !revisedFile) return;
  status("transferStatus", "GoodNotes 구조와 PDF 페이지를 기기 안에서 분석하고 있습니다…", "working");
  byId<HTMLButtonElement>("analyzeTransferButton").disabled = true;
  try {
    inspection = await inspectGoodNotes(goodnotesFile);
    revisedWorkspace.clear();
    await revisedWorkspace.addFiles([revisedFile]);
    transferOrder = [...revisedWorkspace.pages];
    sourceFingerprints = await fingerprintPdf(
      inspection.backgroundBytes,
      (message) => status("transferStatus", message, "working"),
      "기존 배경",
    );
    const targetBytes = revisedWorkspace.sources.values().next().value?.bytes;
    if (!targetBytes) throw new Error("수정 PDF를 읽지 못했습니다.");
    targetFingerprints = await fingerprintPdf(
      targetBytes,
      (message) => status("transferStatus", message, "working"),
      "수정 PDF",
    );
    transferMatch = matchFingerprints(sourceFingerprints, targetFingerprints);
    const activeSources = new Set(inspection.activePages
      .filter((page) => page.attachmentId && inspection!.backgroundAttachmentIds.includes(page.attachmentId))
      .flatMap((page) => page.pdfPage == null ? [] : [page.pdfPage - 1]));
    reviewDecisions = new Map();
    reviewPairs = transferMatch.pairs.filter((pair) => pair.sourceIndex != null && pair.targetIndex != null && activeSources.has(pair.sourceIndex)
      && (pair.distance ?? 0) > 0.0005 && ((pair.distance ?? 1) >= 0.25 || (pair.margin != null && pair.margin < 0.08)));
    refreshTransferStatuses(activeSources);
    renderTransferReviews();
    byId("activePages").textContent = `${inspection.activePages.length}장`;
    byId("sourcePages").textContent = `${inspection.backgroundPageCount}장`;
    byId("targetPages").textContent = `${transferOrder.length}장`;
    byId("formatVersion").textContent = inspection.eventVersion >= 35 ? "GoodNotes 6" : "GoodNotes 5 호환";
    byId("transferResult").hidden = false;
    syncCreateButtons();
    const added = [...transferStatuses.values()].filter((value) => value === "added").length;
    const review = [...transferStatuses.values()].filter((value) => value === "review").length;
    status("transferStatus", `페이지 매칭을 완료했습니다. 새 페이지 ${added}장 · 확인 필요 ${review}장입니다.`, "success");
  } catch (error) {
    status("transferStatus", error instanceof Error ? error.message : "분석에 실패했습니다.", "error");
  } finally {
    byId<HTMLButtonElement>("analyzeTransferButton").disabled = !(goodnotesFile && revisedFile);
  }
});

function activeBackgroundSources(): Set<number> {
  if (!inspection) return new Set();
  return new Set(inspection.activePages
    .filter((page) => page.attachmentId && inspection!.backgroundAttachmentIds.includes(page.attachmentId))
    .flatMap((page) => page.pdfPage == null ? [] : [page.pdfPage - 1]));
}

function refreshTransferStatuses(activeSources = activeBackgroundSources()): void {
  transferStatuses = new Map();
  for (let targetIndex = 0; targetIndex < targetFingerprints.length; targetIndex++) {
    const sourceIndex = [...(transferMatch?.mapping ?? new Map())].find(([, target]) => target === targetIndex)?.[0];
    const review = reviewPairs.find((pair) => pair.sourceIndex === sourceIndex && pair.targetIndex === targetIndex);
    const decision = review ? reviewDecisions.get(reviewKey(review)) : undefined;
    transferStatuses.set(targetIndex,
      sourceIndex == null || !activeSources.has(sourceIndex) || decision === "different" ? "added" : review && !decision ? "review" : "kept");
  }
}

function reviewKey(pair: PagePair): string { return `${pair.sourceIndex}:${pair.targetIndex}`; }

function renderTransferReviews(): void {
  const section = byId<HTMLElement>("transferReviewsSection"), container = byId("transferReviews");
  section.hidden = !reviewPairs.length;
  container.replaceChildren();
  const answered = reviewPairs.filter((pair) => reviewDecisions.has(reviewKey(pair))).length;
  byId("reviewProgress").textContent = `${answered} / ${reviewPairs.length} 확인`;
  if (!inspection) return;
  const backgroundSource: PdfSource = {
    id: `goodnotes-background-${inspection.backgroundBytes.length}`,
    name: "기존 GoodNotes 배경",
    file: new File([inspection.backgroundBytes.slice().buffer as ArrayBuffer], "background.pdf", { type: "application/pdf" }),
    bytes: inspection.backgroundBytes,
    pageCount: inspection.backgroundPageCount,
    dimensions: [],
  };
  const targetSource = revisedWorkspace.sources.values().next().value;
  for (const [index, pair] of reviewPairs.entries()) {
    const key = reviewKey(pair), decision = reviewDecisions.get(key);
    const card = document.createElement("article");
    card.className = "transfer-review-card";
    card.innerHTML = `
      <div class="review-title"><strong>확인 ${index + 1} · 기존 ${pair.sourceIndex! + 1}쪽 ↔ 수정 ${pair.targetIndex! + 1}쪽</strong><span>거리 ${(pair.distance ?? 0).toFixed(3)}</span></div>
      <div class="review-images"><div><small>기존 페이지</small><img alt="기존 ${pair.sourceIndex! + 1}쪽"></div><div><small>수정 페이지</small><img alt="수정 ${pair.targetIndex! + 1}쪽"></div></div>
      <div class="review-actions"><button type="button" class="secondary ${decision === "same" ? "selected" : ""}" data-value="same">같은 페이지</button><button type="button" class="quiet ${decision === "different" ? "selected danger" : ""}" data-value="different">다른 페이지</button></div>`;
    const images = card.querySelectorAll<HTMLImageElement>("img");
    void renderThumbnail(backgroundSource, pair.sourceIndex!).then((value) => { if (images[0]) images[0].src = value; });
    if (targetSource) void renderThumbnail(targetSource, pair.targetIndex!).then((value) => { if (images[1]) images[1].src = value; });
    card.querySelectorAll<HTMLButtonElement>("[data-value]").forEach((button) => button.addEventListener("click", () => {
      const value = button.dataset.value as "same" | "different";
      reviewDecisions.set(key, value);
      if (value === "different") transferMatch?.mapping.delete(pair.sourceIndex!);
      else if (pair.sourceIndex != null && pair.targetIndex != null) transferMatch?.mapping.set(pair.sourceIndex, pair.targetIndex);
      refreshTransferStatuses(); renderTransferReviews();
      if (byId<HTMLDetailsElement>("transferMapDetails").open) transferBoard?.render();
      syncCreateButtons();
    }));
    container.append(card);
  }
}

function syncCreateButtons(): void {
  const ready = Boolean(goodnotesFile && inspection && transferMatch && targetFingerprints.length
    && reviewPairs.every((pair) => reviewDecisions.has(reviewKey(pair))));
  byId<HTMLButtonElement>("createGoodnotesButton").disabled = !ready;
  byId<HTMLButtonElement>("createGoodnotesDriveButton").disabled = !ready;
}

byId<HTMLDetailsElement>("transferMapDetails").addEventListener("toggle", (event) => {
  const details = event.currentTarget as HTMLDetailsElement;
  details.querySelector(".summary-action")!.textContent = details.open ? "접기" : "펼치기";
  if (!details.open || !transferOrder.length) return;
  transferBoard ??= new PageBoard({
    container: byId("transferPageBoard"),
    pages: () => transferOrder.map((page, index): BoardPage => ({
      id: page.id,
      title: `${index + 1}번째`,
      subtitle: `수정 PDF ${page.pageIndex + 1}쪽`,
      status: transferStatuses.get(page.pageIndex) ?? "added",
    })),
    thumbnail: async (page) => {
      const item = transferOrder.find((candidate) => candidate.id === page.id)!;
      return renderThumbnail(revisedWorkspace.sources.get(item.sourceId)!, item.pageIndex);
    },
    onReorder: (oldIndex, newIndex) => {
      const [moved] = transferOrder.splice(oldIndex, 1);
      if (moved) transferOrder.splice(newIndex, 0, moved);
    },
  });
  transferBoard.render();
});

async function createTransferredFile(): Promise<File> {
  if (!goodnotesFile || !inspection || !transferMatch) throw new Error("파일을 다시 분석해 주세요.");
  const revisedBytes = revisedWorkspace.sources.values().next().value?.bytes;
  if (!revisedBytes) throw new Error("수정 PDF를 찾지 못했습니다.");
  const rejected = new Set(reviewPairs.filter((pair) => reviewDecisions.get(reviewKey(pair)) === "different").map(reviewKey));
  const effectiveMatch: MatchResult = {
    ...transferMatch,
    pairs: transferMatch.pairs.filter((pair) => !rejected.has(reviewKey(pair))),
    mapping: new Map(transferMatch.mapping),
  };
  const result = await transferGoodNotes({
    sourceFile: goodnotesFile,
    revisedBytes,
    backgroundPath: inspection.backgroundPath,
    targetOrder: transferOrder.map((page) => page.pageIndex),
    match: effectiveMatch,
    sourceFingerprints,
    targetFingerprints,
  });
  const stem = goodnotesFile.name.replace(/\.goodnotes$/i, "");
  status("transferStatus", `완료 · 최종 활성 ${result.finalActivePages}장 · 추가 ${result.pagesAdded}장 · 삭제 ${result.pagesDeleted}장 · 맨 뒤 보관 ${result.pagesKeptAtEnd}장`, "success");
  return new File([result.bytes.buffer as ArrayBuffer], `${stem}_transferred.goodnotes`, { type: "application/octet-stream" });
}

byId("createGoodnotesButton").addEventListener("click", async () => {
  syncCreateButtons();
  status("transferStatus", "페이지 순서와 기존 필기를 반영해 GoodNotes 문서를 만드는 중입니다…", "working");
  try { const file = await createTransferredFile(); await saveFile(file, file.name); }
  catch (error) { status("transferStatus", error instanceof Error ? error.message : "GoodNotes 변환에 실패했습니다.", "error"); }
  finally { syncCreateButtons(); }
});

byId("createGoodnotesDriveButton").addEventListener("click", async () => {
  syncCreateButtons();
  status("transferStatus", "GoodNotes 문서를 만든 뒤 Google Drive에 저장하고 있습니다…", "working");
  try { const file = await createTransferredFile(); await drive.upload(file); status("transferStatus", `${file.name}을 Google Drive에 저장했습니다.`, "success"); }
  catch (error) { status("transferStatus", error instanceof Error ? error.message : "Google Drive 저장에 실패했습니다.", "error"); }
  finally { syncCreateButtons(); }
});

byId<HTMLInputElement>("mergeInput").addEventListener("change", async (event) => {
  await addMergeFiles([...(event.target as HTMLInputElement).files ?? []]);
  (event.target as HTMLInputElement).value = "";
});

async function addMergeFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  status("mergeStatus", "PDF 페이지를 읽고 있습니다…", "working");
  try {
    await mergeWorkspace.addFiles(files);
    renderMergeBoard();
    status("mergeStatus", `${files.length}개 PDF를 추가했습니다.`, "success");
  } catch (error) {
    status("mergeStatus", error instanceof Error ? error.message : "PDF를 추가하지 못했습니다.", "error");
  }
}

function renderMergeBoard(): void {
  byId("mergeWorkspace").hidden = !mergeWorkspace.pages.length;
  byId("mergeCount").textContent = `${mergeWorkspace.pages.filter((page) => page.selected).length}쪽 선택`;
  mergeBoard ??= new PageBoard({
    container: byId("mergePageBoard"),
    pages: () => mergeWorkspace.pages.map((page): BoardPage => ({
      id: page.id,
      title: `${page.sourceName}`,
      subtitle: `${page.pageIndex + 1}쪽`,
      selected: page.selected,
    })),
    thumbnail: async (page) => {
      const item = mergeWorkspace.pages.find((candidate) => candidate.id === page.id)!;
      return renderThumbnail(mergeWorkspace.sources.get(item.sourceId)!, item.pageIndex);
    },
    onReorder: (oldIndex, newIndex) => { mergeWorkspace.reorder(oldIndex, newIndex); },
    onToggle: (page) => { mergeWorkspace.toggle(page.id); queueMicrotask(() => byId("mergeCount").textContent = `${mergeWorkspace.pages.filter((item) => item.selected).length}쪽 선택`); },
  });
  mergeBoard.render();
}

byId("clearMergeButton").addEventListener("click", async () => {
  mergeBoard?.destroy();
  mergeWorkspace.clear();
  await releasePdfPreviews();
  renderMergeBoard();
  status("mergeStatus");
});

async function createMergedFile(): Promise<File> {
  const bytes = await mergeWorkspace.merge();
  let name = byId<HTMLInputElement>("mergeOutputName").value.trim() || "합친-강의록.pdf";
  if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

byId("mergeSaveButton").addEventListener("click", async () => {
  status("mergeStatus", "선택한 순서대로 PDF를 만들고 있습니다…", "working");
  try {
    const file = await createMergedFile();
    await saveFile(file, file.name);
    status("mergeStatus", "PDF를 만들었습니다.", "success");
  } catch (error) { status("mergeStatus", error instanceof Error ? error.message : "PDF 저장에 실패했습니다.", "error"); }
});

byId("mergeDriveSaveButton").addEventListener("click", async () => {
  status("mergeStatus", "PDF를 만든 뒤 Google Drive에 저장하고 있습니다…", "working");
  try {
    const file = await createMergedFile();
    await drive.upload(file);
    status("mergeStatus", `${file.name}을 Google Drive에 저장했습니다.`, "success");
  } catch (error) { status("mergeStatus", error instanceof Error ? error.message : "Drive 저장에 실패했습니다.", "error"); }
});

byId("mergeDriveButton").addEventListener("click", async () => {
  try { await addMergeFiles((await drive.pickFiles()).filter((file) => file.name.toLowerCase().endsWith(".pdf"))); }
  catch (error) { if ((error as DOMException).name !== "AbortError") status("mergeStatus", (error as Error).message, "error"); }
});

byId("transferDriveButton").addEventListener("click", async () => {
  try {
    const files = await drive.pickFiles();
    goodnotesFile = files.find((file) => file.name.toLowerCase().endsWith(".goodnotes")) ?? goodnotesFile;
    revisedFile = files.find((file) => file.name.toLowerCase().endsWith(".pdf")) ?? revisedFile;
    byId("goodnotesName").textContent = goodnotesFile?.name ?? ".goodnotes 파일 선택";
    byId("revisedName").textContent = revisedFile?.name ?? ".pdf 파일 선택";
    syncTransferReady();
  } catch (error) { if ((error as DOMException).name !== "AbortError") status("transferStatus", (error as Error).message, "error"); }
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => void navigator.serviceWorker.register("./sw.js"));
