export interface GoogleDriveConfig {
  clientId: string;
  apiKey: string;
  projectNumber: string;
}

interface TokenResponse { access_token?: string; error?: string }
interface PickerDocument { id: string; name: string; mimeType: string }

declare global {
  interface Window {
    google?: {
      accounts: { oauth2: { initTokenClient(options: Record<string, unknown>): { requestAccessToken(options?: Record<string, unknown>): void } } };
      picker: Record<string, any>;
    };
    gapi?: { load(name: string, callback: () => void): void };
  }
}

const SETTINGS_KEY = "goodnotes-studio.google-drive";

export class GoogleDriveClient {
  private accessToken = "";
  private tokenClient: { requestAccessToken(options?: Record<string, unknown>): void } | null = null;

  get config(): GoogleDriveConfig {
    try {
      return { clientId: "", apiKey: "", projectNumber: "", ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch {
      return { clientId: "", apiKey: "", projectNumber: "" };
    }
  }

  saveConfig(config: GoogleDriveConfig): void {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(config));
  }

  async connect(): Promise<void> {
    const config = this.config;
    if (!config.clientId || !config.apiKey || !config.projectNumber) {
      throw new Error("설정에서 Google OAuth Client ID, Cloud 프로젝트 번호, Picker API Key를 입력해 주세요.");
    }
    await Promise.all([
      loadScript("https://accounts.google.com/gsi/client", "google-identity"),
      loadScript("https://apis.google.com/js/api.js", "google-api"),
    ]);
    await new Promise<void>((resolve) => window.gapi?.load("picker", resolve));
    await new Promise<void>((resolve, reject) => {
      this.tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: "https://www.googleapis.com/auth/drive.file",
        callback: (response: TokenResponse) => {
          if (response.error || !response.access_token) reject(new Error("Google Drive 로그인을 완료하지 못했습니다."));
          else { this.accessToken = response.access_token; resolve(); }
        },
        error_callback: () => reject(new Error("Google Drive 로그인 창이 닫혔습니다.")),
      });
      this.tokenClient.requestAccessToken({ prompt: this.accessToken ? "" : "consent" });
    });
  }

  async pickFiles(): Promise<File[]> {
    if (!this.accessToken) await this.connect();
    const pickerApi = window.google!.picker;
    const view = new pickerApi.DocsView()
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false)
      .setMimeTypes("application/pdf,application/zip,application/octet-stream");
    const documents = await new Promise<PickerDocument[]>((resolve, reject) => {
      const picker = new pickerApi.PickerBuilder()
        .setAppId(this.config.projectNumber)
        .setDeveloperKey(this.config.apiKey)
        .setOAuthToken(this.accessToken)
        .addView(view)
        .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
        .setCallback((data: Record<string, any>) => {
          if (data.action === pickerApi.Action.PICKED) resolve(data.docs as PickerDocument[]);
          if (data.action === pickerApi.Action.CANCEL) reject(new DOMException("선택을 취소했습니다.", "AbortError"));
        })
        .build();
      picker.setVisible(true);
    });
    return Promise.all(documents.map((document) => this.download(document)));
  }

  async upload(file: File): Promise<void> {
    if (!this.accessToken) await this.connect();
    const body = new FormData();
    body.append("metadata", new Blob([JSON.stringify({ name: file.name })], { type: "application/json" }));
    body.append("file", file, file.name);
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body,
    });
    if (!response.ok) throw new Error(`Google Drive 저장에 실패했습니다. (${response.status})`);
  }

  private async download(document: PickerDocument): Promise<File> {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.id)}?alt=media`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!response.ok) throw new Error(`${document.name} 다운로드에 실패했습니다.`);
    return new File([await response.blob()], document.name, { type: document.mimeType || "application/octet-stream" });
  }
}

function loadScript(src: string, id: string): Promise<void> {
  if (document.getElementById(id)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google 연동 모듈을 불러오지 못했습니다."));
    document.head.append(script);
  });
}
