import "./styles.css";
import "./landing.css";
import "./review.css";
import { PdfWorkspace, type PdfPageItem, type PdfSource } from "./pdf/composer";
import { renderThumbnail, releasePdfPreviews } from "./pdf/thumbnail";
import { PageBoard, type BoardPage } from "./ui/page-board";
import { saveFile } from "./lib/save-file";
import { normalizeGoodNotesOutputName, suggestGoodNotesOutputName } from "./lib/file-name";
import { inspectGoodNotes, type GoodNotesInspection, type GoodNotesPage } from "./goodnotes/archive";
import { fingerprintPdf, matchFingerprintsAsync, type MatchResult } from "./pdf/page-match";
import type { PageFingerprint, PagePair } from "./pdf/page-match";
import { requiresPageReview } from "./pdf/review-policy";
import { transferGoodNotes } from "./goodnotes/transfer";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="app-header">
    <div class="brand"><span class="brand-mark">GN</span><div><strong>GoodNotes Transfer Studio</strong><small>기기에서 안전하게 처리</small></div></div>
    <div class="header-actions"><button id="installButton" class="quiet" hidden>앱 설치</button></div>
  </header>
  <main>
    <section class="hero">
      <span class="eyebrow">GoodNotes 5 &amp; 6 · Studio R3.2</span>
      <h1>수정된 강의록에<br>기존 필기를 그대로.</h1>
      <p>페이지를 자동으로 비교하고 새 페이지는 삽입합니다. 기존 필기는 그대로 보존하며, 필요한 경우 전체 페이지 순서도 직접 바꿀 수 있어요.</p>
    </section>
    <nav class="tabs" aria-label="작업 선택">
      <button class="tab active" data-tab="transfer">GoodNotes 옮기기</button>
      <button class="tab" data-tab="merge">PDF 합치기</button>
    </nav>

    <section id="transferPanel" class="panel active">
      <div class="panel-heading transfer-heading"><div><span class="step-label">GOODNOTES</span><h2>수정 강의록에 기존 필기 옮기기</h2></div></div>
      <div class="file-grid">
        <label class="file-card"><span class="file-title-row"><span class="file-number">1</span><strong>기존 GoodNotes 문서</strong></span><small>필기해 둔 GoodNotes 5·6 문서를 선택하세요.</small><span id="goodnotesName" class="file-choice">.goodnotes 선택</span><input id="goodnotesInput" type="file" accept=".goodnotes" /></label>
        <label class="file-card"><span class="file-title-row"><span class="file-number">2</span><strong>수정된 강의록 PDF</strong></span><small>새로 배포된 수정 강의록 PDF를 선택하세요.</small><span id="revisedName" class="file-choice">PDF 선택</span><input id="revisedInput" type="file" accept="application/pdf,.pdf" /></label>
      </div>
      <div class="row-actions transfer-actions"><button id="analyzeTransferButton" class="primary" disabled>페이지 비교하기</button></div>
      <p class="privacy-note">🔒 파일은 서버에 업로드하지 않고 현재 기기 안에서 분석·변환합니다. 원본 파일은 직접 삭제되지 않습니다.</p>
      <div id="transferStatus" class="status" aria-live="polite"></div>
      <section id="transferResult" class="result" hidden>
        <div class="change-summary-head">
          <div><h2>변경사항 확인</h2><p id="changeSummaryText">페이지 변경을 확인했습니다.</p></div>
          <button id="chooseOtherFilesButton" class="quiet">다른 파일 선택</button>
        </div>
        <div class="metrics">
          <div><span>기존 활성 페이지</span><strong id="activePages">-</strong></div>
          <div class="metric-added"><span>새 페이지</span><strong id="addedPages">-</strong></div>
          <div class="metric-deleted"><span>삭제 후보</span><strong id="deletedPages">-</strong></div>
          <div class="metric-review"><span>직접 확인</span><strong id="reviewPages">-</strong></div>
        </div>
        <div class="matching-rule"><strong>자동 매칭 기준</strong><p>거리 0.25 미만은 자동으로 같은 페이지로 처리합니다. 0.25 이상이거나 비슷한 후보가 여러 개면 아래에서 직접 확인하세요.</p></div>
        <section id="transferReviewsSection" class="transfer-reviews" hidden>
          <div class="section-heading"><strong>수정된 페이지 확인</strong><small id="reviewProgress"></small></div>
          <div id="transferReviews"></div>
        </section>
        <section id="deletedReviewsSection" class="transfer-reviews deleted-reviews" hidden>
          <div class="section-heading"><span><strong>필기가 있는 삭제 후보</strong><small>수정 PDF에서 사라진 페이지입니다. 맨 뒤에 보관할지 삭제할지 선택하세요.</small></span><small id="deletedReviewProgress"></small></div>
          <div id="deletedReviews"></div>
        </section>
        <details id="transferMapDetails" class="page-map-details">
          <summary><span><strong>전체 페이지 구성표</strong><small>원할 때 열어 페이지 순서를 확인·변경하세요.</small></span><span class="summary-action">펼치기</span></summary>
          <div class="map-help">손잡이 <b>⠿</b>를 잡고 드래그하세요. iPad에서는 손잡이를 잠깐 누른 뒤 이동하면 됩니다.</div>
          <div id="transferPageBoard" class="page-board"></div>
        </details>
        <div class="transfer-save-row">
          <label for="transferOutputName"><span>새 파일 이름</span><input id="transferOutputName" value="변환된-GoodNotes.goodnotes" autocomplete="off" spellcheck="false" /></label>
          <button id="createGoodnotesButton" class="primary" disabled>기기에 GoodNotes 저장</button>
        </div>
      </section>
    </section>

    <section id="mergePanel" class="panel">
      <div class="panel-heading"><div><span class="step-label">PDF COMPOSER</span><h2>여러 PDF에서 필요한 페이지 합치기</h2></div></div>
      <label class="merge-drop"><strong>PDF 추가</strong><small>여러 파일을 한 번에 선택할 수 있습니다.</small><input id="mergeInput" type="file" accept="application/pdf,.pdf" multiple /></label>
      <div class="row-actions"><button id="clearMergeButton" class="quiet">모두 비우기</button></div>
      <div id="mergeStatus" class="status" aria-live="polite"></div>
      <section id="mergeWorkspace" hidden>
        <div class="board-toolbar"><div><strong id="mergeCount">0쪽</strong><small>페이지를 눌러 포함·제외하고, ⠿ 손잡이로 순서를 바꾸세요.</small></div><input id="mergeOutputName" value="합친-강의록.pdf" aria-label="저장할 PDF 이름" /></div>
        <div id="mergePageBoard" class="page-board"></div>
        <div class="row-actions sticky-actions"><button id="mergeSaveButton" class="primary">기기에 PDF 저장</button></div>
      </section>
    </section>

    <section class="guide" aria-labelledby="guideTitle">
      <div class="guide-heading"><span class="step-label">HOW TO USE</span><h2 id="guideTitle">처음 사용하시나요?</h2><p>GoodNotes에서 필기하던 강의록을 수정 PDF로 옮기는 과정은 네 단계면 됩니다.</p></div>
      <div class="guide-grid">
        <article><span>1</span><strong>파일 선택</strong><p>기존 .goodnotes 문서와 수정된 강의록 PDF를 Mac 또는 iPad의 파일 앱에서 선택합니다.</p></article>
        <article><span>2</span><strong>페이지 비교</strong><p>본문과 이미지를 기준으로 페이지를 자동 매칭합니다. 거리 0.25 미만은 같은 페이지로 자동 처리합니다.</p></article>
        <article><span>3</span><strong>결과 확인</strong><p>애매한 페이지와 필기가 있는 삭제 후보를 확인하고, 원하면 전체 페이지 구성표에서 ⠿ 손잡이로 순서를 바꿉니다.</p></article>
        <article><span>4</span><strong>GoodNotes 저장</strong><p>확인한 결과를 기기에 저장한 뒤 GoodNotes에서 새 문서로 불러옵니다.</p></article>
      </div>
      <div class="guide-extra">
        <div><strong>PDF 합치기</strong><p>상단의 PDF 합치기 탭에서 여러 PDF를 추가하고, 페이지를 제외하거나 드래그해 순서를 바꾼 뒤 하나로 저장하세요.</p></div>
        <div><strong>Mac·iPad에 설치</strong><p>Safari 공유 메뉴의 ‘홈 화면에 추가’ 또는 Mac Safari의 ‘Dock에 추가’를 사용하면 앱처럼 실행할 수 있습니다.</p></div>
        <div><strong>안전하게 사용하기</strong><p>결과를 GoodNotes에서 확인할 때까지 원본 .goodnotes 파일을 별도로 보관하세요.</p></div>
      </div>
    </section>
  </main>

`;

const mergeWorkspace = new PdfWorkspace();
const revisedWorkspace = new PdfWorkspace();
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
let deletedPageDecisions = new Map<number, "keep" | "delete">();
let transferPreviewSourceIds = new Set<string>();
let transferPreviewSession = 0;
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

byId<HTMLInputElement>("goodnotesInput").addEventListener("change", async (event) => {
  goodnotesFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  byId("goodnotesName").textContent = goodnotesFile?.name ?? ".goodnotes 선택";
  byId<HTMLInputElement>("transferOutputName").value = goodnotesFile
    ? suggestGoodNotesOutputName(goodnotesFile.name)
    : "변환된-GoodNotes.goodnotes";
  await resetTransferAnalysis();
  syncTransferReady();
});
byId<HTMLInputElement>("revisedInput").addEventListener("change", async (event) => {
  revisedFile = (event.target as HTMLInputElement).files?.[0] ?? null;
  byId("revisedName").textContent = revisedFile?.name ?? "PDF 선택";
  await resetTransferAnalysis();
  syncTransferReady();
});

function syncTransferReady(): void {
  byId<HTMLButtonElement>("analyzeTransferButton").disabled = !(goodnotesFile && revisedFile);
  byId("transferResult").hidden = true;
}

async function resetTransferAnalysis(): Promise<void> {
  transferBoard?.destroy();
  transferBoard = null;
  byId("transferReviews").replaceChildren();
  byId<HTMLElement>("transferReviewsSection").hidden = true;
  byId("deletedReviews").replaceChildren();
  byId<HTMLElement>("deletedReviewsSection").hidden = true;
  const details = byId<HTMLDetailsElement>("transferMapDetails");
  details.open = false;
  details.querySelector(".summary-action")!.textContent = "펼치기";
  byId("transferResult").hidden = true;
  byId<HTMLButtonElement>("createGoodnotesButton").disabled = true;
  await releasePdfPreviews(transferPreviewSourceIds);
  transferPreviewSourceIds = new Set();
  revisedWorkspace.clear();
  inspection = null;
  transferOrder = [];
  transferMatch = null;
  transferStatuses = new Map();
  sourceFingerprints = [];
  targetFingerprints = [];
  reviewPairs = [];
  reviewDecisions = new Map();
  deletedPageDecisions = new Map();
  transferPreviewSession++;
  status("transferStatus");
}

function yieldToBrowser(): Promise<void> {
  // A requestAnimationFrame callback runs before paint; continuing from it can
  // still block Safari from drawing the new status. A new task lets it paint.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

byId("analyzeTransferButton").addEventListener("click", async () => {
  if (!goodnotesFile || !revisedFile) return;
  byId<HTMLButtonElement>("analyzeTransferButton").disabled = true;
  byId<HTMLInputElement>("goodnotesInput").disabled = true;
  byId<HTMLInputElement>("revisedInput").disabled = true;
  try {
    await resetTransferAnalysis();
    status("transferStatus", "GoodNotes 구조와 PDF 페이지를 기기 안에서 분석하고 있습니다…", "working");
    await yieldToBrowser();
    inspection = await inspectGoodNotes(goodnotesFile);
    await revisedWorkspace.addFiles([revisedFile]);
    for (const sourceId of revisedWorkspace.sources.keys()) transferPreviewSourceIds.add(sourceId);
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
    status("transferStatus", "페이지 대응 관계를 계산하고 있습니다…", "working");
    await yieldToBrowser();
    transferMatch = await matchFingerprintsAsync(sourceFingerprints, targetFingerprints, (completed, total) => {
      const percent = total ? Math.round(completed / total * 100) : 100;
      status("transferStatus", `페이지 대응 관계를 계산하고 있습니다… ${percent}%`, "working");
    });
    const activeSources = new Set(inspection.activePages
      .filter((page) => page.attachmentId && inspection!.backgroundAttachmentIds.includes(page.attachmentId))
      .flatMap((page) => page.pdfPage == null ? [] : [page.pdfPage - 1]));
    reviewDecisions = new Map();
    reviewPairs = transferMatch.pairs.filter((pair) => pair.sourceIndex != null
      && activeSources.has(pair.sourceIndex)
      && requiresPageReview(pair));
    refreshTransferStatuses(activeSources);
    renderTransferReviews();
    renderDeletedReviews();
    byId("activePages").textContent = `${inspection.activePages.length}장`;
    refreshTransferSummary();
    byId("transferResult").hidden = false;
    syncCreateButtons();
    status("transferStatus");
  } catch (error) {
    status("transferStatus", error instanceof Error ? error.message : "분석에 실패했습니다.", "error");
  } finally {
    byId<HTMLInputElement>("goodnotesInput").disabled = false;
    byId<HTMLInputElement>("revisedInput").disabled = false;
    byId<HTMLButtonElement>("analyzeTransferButton").disabled = !(goodnotesFile && revisedFile);
  }
});

byId("chooseOtherFilesButton").addEventListener("click", () => {
  document.querySelector(".file-grid")?.scrollIntoView({ behavior: "smooth", block: "center" });
});

function activeBackgroundSources(): Set<number> {
  if (!inspection) return new Set();
  return new Set(inspection.activePages
    .filter((page) => page.attachmentId && inspection!.backgroundAttachmentIds.includes(page.attachmentId))
    .flatMap((page) => page.pdfPage == null ? [] : [page.pdfPage - 1]));
}

function extraActivePages(): GoodNotesPage[] {
  if (!inspection) return [];
  const backgroundIds = new Set(inspection.backgroundAttachmentIds), latestByPdfPage = new Map<number, GoodNotesPage>();
  const extras: GoodNotesPage[] = [];
  for (const page of inspection.activePages) {
    if (!page.attachmentId || !backgroundIds.has(page.attachmentId) || page.pdfPage == null) {
      extras.push(page);
      continue;
    }
    const prior = latestByPdfPage.get(page.pdfPage);
    if (!prior) {
      latestByPdfPage.set(page.pdfPage, page);
      continue;
    }
    const priorHasNotes = (inspection.entries[prior.notePath]?.length ?? 0) > 0;
    const pageHasNotes = (inspection.entries[page.notePath]?.length ?? 0) > 0;
    if (priorHasNotes && !pageHasNotes) {
      continue;
    }
    // Empty duplicate sheets are removed during conversion. Only a duplicate
    // that actually contains notes remains as a separate existing page.
    if (priorHasNotes) extras.push(prior);
    latestByPdfPage.set(page.pdfPage, page);
  }
  return extras;
}

function transferBackgroundSource(): PdfSource | null {
  if (!inspection) return null;
  const backgroundId = `goodnotes-background-${transferPreviewSession}`;
  transferPreviewSourceIds.add(backgroundId);
  return {
    id: backgroundId,
    name: "기존 GoodNotes 배경",
    file: new File([inspection.backgroundBytes.slice().buffer as ArrayBuffer], "background.pdf", { type: "application/pdf" }),
    bytes: inspection.backgroundBytes,
    pageCount: inspection.backgroundPageCount,
    dimensions: [],
  };
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
  const backgroundSource = transferBackgroundSource();
  if (!backgroundSource) return;
  const targetSource = revisedWorkspace.sources.values().next().value;
  for (const [index, pair] of reviewPairs.entries()) {
    const key = reviewKey(pair), decision = reviewDecisions.get(key);
    const card = document.createElement("article");
    card.className = "transfer-review-card";
    card.innerHTML = `
      <div class="review-title"><strong>확인 ${index + 1} · 기존 ${pair.sourceIndex! + 1}쪽 ↔ 수정 ${pair.targetIndex! + 1}쪽</strong><span>거리 ${(pair.distance ?? 0).toFixed(3)}</span></div>
      <div class="review-images"><div><small>기존 페이지</small><img alt="기존 ${pair.sourceIndex! + 1}쪽"></div><div><small>수정 페이지</small><img alt="수정 ${pair.targetIndex! + 1}쪽"></div></div>
      <div class="review-actions"><small class="review-action-note">‘같은 페이지’를 누르면 기존 페이지의 필기가 수정 페이지로 옮겨져 대치됩니다.</small><button type="button" class="secondary ${decision === "same" ? "selected" : ""}" data-value="same">같은 페이지</button><button type="button" class="quiet ${decision === "different" ? "selected danger" : ""}" data-value="different">다른 페이지</button></div>`;
    const images = card.querySelectorAll<HTMLImageElement>("img");
    void renderThumbnail(backgroundSource, pair.sourceIndex!).then((value) => { if (images[0]?.isConnected) images[0].src = value; }).catch(() => undefined);
    if (targetSource) void renderThumbnail(targetSource, pair.targetIndex!).then((value) => { if (images[1]?.isConnected) images[1].src = value; }).catch(() => undefined);
    card.querySelectorAll<HTMLButtonElement>("[data-value]").forEach((button) => button.addEventListener("click", () => {
      const value = button.dataset.value as "same" | "different";
      reviewDecisions.set(key, value);
      if (value === "different") transferMatch?.mapping.delete(pair.sourceIndex!);
      else if (pair.sourceIndex != null && pair.targetIndex != null) transferMatch?.mapping.set(pair.sourceIndex, pair.targetIndex);
      refreshTransferStatuses(); renderTransferReviews();
      renderDeletedReviews();
      refreshTransferSummary();
      if (byId<HTMLDetailsElement>("transferMapDetails").open) transferBoard?.render();
      syncCreateButtons();
    }));
    container.append(card);
  }
}

function deletedNoteCandidates(): number[] {
  if (!inspection || !transferMatch) return [];
  const matched = new Set(transferMatch.mapping.keys());
  return [...activeBackgroundSources()].filter((sourceIndex) => {
    if (matched.has(sourceIndex)) return false;
    const page = inspection!.activePages.find((candidate) => candidate.pdfPage === sourceIndex + 1
      && candidate.attachmentId && inspection!.backgroundAttachmentIds.includes(candidate.attachmentId));
    return Boolean(page && (inspection!.entries[page.notePath]?.length ?? 0) > 0);
  }).sort((left, right) => left - right);
}

function refreshTransferSummary(): void {
  const activeSources = activeBackgroundSources(), matchedSources = new Set(transferMatch?.mapping.keys() ?? []);
  const added = [...transferStatuses.values()].filter((value) => value === "added").length;
  const deleted = [...activeSources].filter((sourceIndex) => !matchedSources.has(sourceIndex)).length;
  const candidates = deletedNoteCandidates();
  const directReview = reviewPairs.length + candidates.length;
  const kept = candidates.filter((sourceIndex) => deletedPageDecisions.get(sourceIndex) === "keep").length;
  const baseFinal = transferOrder.length + extraActivePages().length;
  byId("addedPages").textContent = `${added}장`;
  byId("deletedPages").textContent = `${deleted}장`;
  byId("reviewPages").textContent = `${directReview}장`;
  byId("changeSummaryText").textContent = `페이지 변경을 찾았습니다: 추가 ${added}장${deleted ? ` · 삭제 후보 ${deleted}장` : ""} · 현재 예상 최종 ${baseFinal + kept}장.`;
}

function renderDeletedReviews(): void {
  const section = byId<HTMLElement>("deletedReviewsSection"), container = byId("deletedReviews");
  const candidates = deletedNoteCandidates();
  for (const sourceIndex of [...deletedPageDecisions.keys()]) {
    if (!candidates.includes(sourceIndex)) deletedPageDecisions.delete(sourceIndex);
  }
  section.hidden = !candidates.length;
  container.replaceChildren();
  const answered = candidates.filter((sourceIndex) => deletedPageDecisions.has(sourceIndex)).length;
  byId("deletedReviewProgress").textContent = `${answered} / ${candidates.length} 확인`;
  if (!inspection) return;
  const backgroundSource = transferBackgroundSource();
  if (!backgroundSource) return;
  for (const [index, sourceIndex] of candidates.entries()) {
    const decision = deletedPageDecisions.get(sourceIndex), card = document.createElement("article");
    card.className = "transfer-review-card deleted-review-card";
    card.innerHTML = `
      <div class="review-title"><strong>삭제 후보 ${index + 1} · 기존 ${sourceIndex + 1}쪽</strong><span>필기 있음</span></div>
      <div class="deleted-review-image"><small>기존 페이지와 필기 데이터는 원본에 그대로 남아 있습니다.</small><img alt="삭제 후보 기존 ${sourceIndex + 1}쪽"></div>
      <div class="review-actions"><button type="button" class="secondary ${decision === "keep" ? "selected" : ""}" data-value="keep">맨 뒤에 보관</button><button type="button" class="quiet ${decision === "delete" ? "selected danger" : ""}" data-value="delete">삭제</button></div>`;
    const image = card.querySelector<HTMLImageElement>("img");
    void renderThumbnail(backgroundSource, sourceIndex).then((value) => { if (image?.isConnected) image.src = value; }).catch(() => undefined);
    card.querySelectorAll<HTMLButtonElement>("[data-value]").forEach((button) => button.addEventListener("click", () => {
      deletedPageDecisions.set(sourceIndex, button.dataset.value as "keep" | "delete");
      renderDeletedReviews();
      refreshTransferSummary();
      syncCreateButtons();
    }));
    container.append(card);
  }
}

function syncCreateButtons(): void {
  const ready = Boolean(goodnotesFile && inspection && transferMatch && targetFingerprints.length
    && reviewPairs.every((pair) => reviewDecisions.has(reviewKey(pair)))
    && deletedNoteCandidates().every((sourceIndex) => deletedPageDecisions.has(sourceIndex)));
  byId<HTMLButtonElement>("createGoodnotesButton").disabled = !ready;
}

byId<HTMLDetailsElement>("transferMapDetails").addEventListener("toggle", (event) => {
  const details = event.currentTarget as HTMLDetailsElement;
  details.querySelector(".summary-action")!.textContent = details.open ? "접기" : "펼치기";
  if (!details.open || !transferOrder.length) return;
  transferBoard ??= new PageBoard({
    container: byId("transferPageBoard"),
    pages: () => [...transferOrder.map((page, index): BoardPage => ({
      id: page.id,
      title: `${index + 1}번째`,
      subtitle: `수정 PDF ${page.pageIndex + 1}쪽`,
      status: transferStatuses.get(page.pageIndex) ?? "added",
    })), ...extraActivePages().map((page, index): BoardPage => ({
      id: `existing:${page.noteId}`,
      title: `${transferOrder.length + index + 1}번째`,
      subtitle: page.pdfPage == null ? "기존 별도 페이지" : `기존 PDF ${page.pdfPage}쪽 · 별도 유지`,
      status: "kept",
    }))],
    thumbnail: async (page) => {
      if (page.id.startsWith("existing:")) {
        const existing = extraActivePages().find((candidate) => `existing:${candidate.noteId}` === page.id);
        const source = transferBackgroundSource();
        if (!existing || existing.pdfPage == null || !source) throw new Error("기존 페이지 미리보기를 찾지 못했습니다.");
        return renderThumbnail(source, existing.pdfPage - 1);
      }
      const item = transferOrder.find((candidate) => candidate.id === page.id)!;
      return renderThumbnail(revisedWorkspace.sources.get(item.sourceId)!, item.pageIndex);
    },
    onReorder: (oldIndex, newIndex) => {
      if (oldIndex >= transferOrder.length || newIndex >= transferOrder.length) return;
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
    keepSourcePages: deletedNoteCandidates().filter((sourceIndex) => deletedPageDecisions.get(sourceIndex) === "keep"),
  });
  const outputName = normalizeGoodNotesOutputName(
    byId<HTMLInputElement>("transferOutputName").value,
    goodnotesFile.name,
  );
  byId<HTMLInputElement>("transferOutputName").value = outputName;
  status("transferStatus", `완료 · 최종 활성 ${result.finalActivePages}장 · 추가 ${result.pagesAdded}장 · 삭제 ${result.pagesDeleted}장 · 맨 뒤 보관 ${result.pagesKeptAtEnd}장`, "success");
  return new File([result.bytes.buffer as ArrayBuffer], outputName, { type: "application/octet-stream" });
}

byId("createGoodnotesButton").addEventListener("click", async () => {
  syncCreateButtons();
  status("transferStatus", "페이지 순서와 기존 필기를 반영해 GoodNotes 문서를 만드는 중입니다…", "working");
  try { const file = await createTransferredFile(); await saveFile(file, file.name); }
  catch (error) { status("transferStatus", error instanceof Error ? error.message : "GoodNotes 변환에 실패했습니다.", "error"); }
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
  const sourceIds = [...mergeWorkspace.sources.keys()];
  mergeBoard?.destroy();
  mergeBoard = null;
  mergeWorkspace.clear();
  await releasePdfPreviews(sourceIds);
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

if ("serviceWorker" in navigator) window.addEventListener("load", () => {
  void navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((registration) => registration.update());
});
