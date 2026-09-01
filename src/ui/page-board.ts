import Sortable from "sortablejs";

export interface BoardPage {
  id: string;
  title: string;
  subtitle?: string;
  selected?: boolean;
  status?: "kept" | "added" | "review" | "deleted";
}

export interface PageBoardOptions {
  container: HTMLElement;
  pages: () => BoardPage[];
  thumbnail: (page: BoardPage) => Promise<string>;
  onReorder: (oldIndex: number, newIndex: number) => void;
  onToggle?: (page: BoardPage) => void;
}

export class PageBoard {
  private sortable: Sortable | null = null;
  private observer: IntersectionObserver | null = null;

  constructor(private readonly options: PageBoardOptions) {}

  render(): void {
    this.destroyRuntime();
    const { container } = this.options;
    container.replaceChildren();
    for (const page of this.options.pages()) {
      const card = document.createElement("article");
      card.className = `page-card ${page.selected === false ? "is-off" : "is-on"}`;
      card.dataset.pageId = page.id;
      card.innerHTML = `
        <div class="page-card-head">
          <button class="drag-handle" type="button" aria-label="${page.title} 순서 이동">⠿</button>
          <div><strong>${escapeHtml(page.title)}</strong>${page.subtitle ? `<small>${escapeHtml(page.subtitle)}</small>` : ""}</div>
          ${page.status ? `<span class="page-status ${page.status}">${statusLabel(page.status)}</span>` : ""}
        </div>
        <button class="page-image-button" type="button" aria-label="${page.title} 선택 전환">
          <span class="page-skeleton">미리보기 준비 중</span>
          <img alt="${escapeHtml(page.title)} 미리보기" />
        </button>
        ${this.options.onToggle ? `<button class="page-toggle" type="button">${page.selected === false ? "제외됨 · 다시 포함" : "포함됨 · 눌러 제외"}</button>` : ""}
      `;
      const toggle = () => {
        if (!this.options.onToggle) return;
        this.options.onToggle(page);
        this.render();
      };
      card.querySelector<HTMLButtonElement>(".page-toggle")?.addEventListener("click", toggle);
      card.querySelector<HTMLButtonElement>(".page-image-button")?.addEventListener("click", toggle);
      container.append(card);
    }

    this.sortable = Sortable.create(container, {
      animation: 180,
      handle: ".drag-handle",
      ghostClass: "drag-ghost",
      chosenClass: "drag-chosen",
      dragClass: "drag-active",
      delay: 0,
      delayOnTouchOnly: false,
      touchStartThreshold: 0,
      fallbackTolerance: 4,
      onEnd: ({ oldIndex, newIndex }) => {
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        this.options.onReorder(oldIndex, newIndex);
        this.render();
      },
    });

    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        this.observer?.unobserve(entry.target);
        void this.loadImage(entry.target as HTMLElement);
      }
    }, { rootMargin: "320px" });
    container.querySelectorAll<HTMLElement>(".page-card").forEach((card) => this.observer?.observe(card));
  }

  destroy(): void {
    this.destroyRuntime();
    this.options.container.replaceChildren();
  }

  private destroyRuntime(): void {
    this.sortable?.destroy();
    this.sortable = null;
    this.observer?.disconnect();
    this.observer = null;
  }

  private async loadImage(card: HTMLElement): Promise<void> {
    const id = card.dataset.pageId;
    const page = this.options.pages().find((candidate) => candidate.id === id);
    const image = card.querySelector<HTMLImageElement>("img");
    const skeleton = card.querySelector<HTMLElement>(".page-skeleton");
    if (!page || !image) return;
    try {
      image.src = await this.options.thumbnail(page);
      image.classList.add("ready");
      skeleton?.remove();
    } catch {
      if (skeleton) skeleton.textContent = "미리보기를 만들지 못했습니다";
    }
  }
}

function statusLabel(status: NonNullable<BoardPage["status"]>): string {
  return { kept: "유지", added: "새 페이지", review: "확인 필요", deleted: "삭제 후보" }[status];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}
