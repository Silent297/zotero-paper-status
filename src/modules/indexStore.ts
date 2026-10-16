import { getPref } from "../utils/prefs";

export const READING_CYCLE = ["未读", "在读", "已读"];
export const INTENT_CYCLE = ["", "不读", "速读", "精读"];
export const SHARE_CYCLE = ["未安排", "已预订", "已分享"];

export type StatusField = "reading" | "intent" | "share" | "star";

export interface PaperEntry {
  id: string;
  title?: string;
  file?: string;
  path?: string;
  reading?: string;
  intent?: string;
  share?: string;
  star?: boolean;
  [key: string]: unknown;
}

export interface IndexDoc {
  version?: number;
  updated?: string;
  papers: PaperEntry[];
}

const DEFAULT_JSON_PATH =
  "C:\\Users\\35150\\Desktop\\学习资料\\paper\\papers_index.json";

function log(message: string) {
  Zotero.debug(`[zotero-paper-status] ${message}`);
}

function formatNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

/**
 * In-memory copy of papers_index.json with read-modify-write persistence.
 * The JSON file stays the single source of truth shared with the web tool.
 */
class IndexStore {
  private doc: IndexDoc | null = null;
  private papersById = new Map<string, PaperEntry>();
  private lastModified = -1;
  private queue: Promise<unknown> = Promise.resolve();

  get path(): string {
    const pref = getPref("jsonPath");
    return typeof pref === "string" && pref ? pref : DEFAULT_JSON_PATH;
  }

  getPapers(): PaperEntry[] {
    return this.doc?.papers ?? [];
  }

  getPaper(paperId: string): PaperEntry | undefined {
    return this.papersById.get(paperId);
  }

  getDisplay(paperId: string, field: StatusField): string {
    const entry = this.papersById.get(paperId);
    if (!entry) {
      return "";
    }
    switch (field) {
      case "reading":
        return String(entry.reading ?? "未读");
      case "intent":
        return entry.intent ? String(entry.intent) : "未标";
      case "share":
        return String(entry.share ?? "未安排");
      case "star":
        return entry.star === true ? "★" : "☆";
      default:
        return "";
    }
  }

  async load(): Promise<boolean> {
    try {
      if (!(await IOUtils.exists(this.path))) {
        log(`data file not found: ${this.path}`);
        return false;
      }
      const raw = await IOUtils.readUTF8(this.path);
      const doc = JSON.parse(raw) as IndexDoc;
      if (!doc || !Array.isArray(doc.papers)) {
        throw new Error("missing papers array");
      }
      this.doc = doc;
      this.rebuildMap();
      const stat = await IOUtils.stat(this.path);
      this.lastModified = stat.lastModified ?? -1;
      log(`loaded ${doc.papers.length} papers`);
      return true;
    } catch (e) {
      log(`load failed (keeping previous data): ${e}`);
      return false;
    }
  }

  /** Returns true when the file changed on disk and data was reloaded. */
  async checkForChanges(): Promise<boolean> {
    try {
      if (!(await IOUtils.exists(this.path))) {
        return false;
      }
      const stat = await IOUtils.stat(this.path);
      const mtime = stat.lastModified ?? -1;
      if (this.doc && mtime === this.lastModified) {
        return false;
      }
      return await this.load();
    } catch (e) {
      log(`change check failed: ${e}`);
      return false;
    }
  }

  setValue(
    paperId: string,
    field: StatusField,
    value: string | boolean,
  ): Promise<boolean> {
    const run = this.queue.then(
      () => this.doWrite(paperId, field, value),
      () => this.doWrite(paperId, field, value),
    );
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doWrite(
    paperId: string,
    field: StatusField,
    value: string | boolean,
  ): Promise<boolean> {
    const path = this.path;
    let doc: IndexDoc;
    try {
      if (!(await IOUtils.exists(path))) {
        log(`write skipped, file not found: ${path}`);
        return false;
      }
      // Re-read just before writing so edits made in the web tool or by the
      // update script are not clobbered by a stale in-memory copy.
      const raw = await IOUtils.readUTF8(path);
      doc = JSON.parse(raw) as IndexDoc;
      if (!doc || !Array.isArray(doc.papers)) {
        throw new Error("missing papers array");
      }
    } catch (e) {
      log(`write aborted, cannot read/parse file: ${e}`);
      return false;
    }
    const entry = doc.papers.find((paper) => paper?.id === paperId);
    if (!entry) {
      log(`write aborted, paper not found: ${paperId}`);
      return false;
    }
    (entry as Record<string, string | boolean>)[field] = value;
    doc.updated = formatNow();
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    try {
      await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` });
    } catch (e) {
      log(`write failed: ${e}`);
      return false;
    }
    this.doc = doc;
    this.rebuildMap();
    try {
      const stat = await IOUtils.stat(path);
      this.lastModified = stat.lastModified ?? -1;
    } catch {
      this.lastModified = -1;
    }
    log(`saved ${paperId}: ${field} = ${String(value)}`);
    return true;
  }

  private rebuildMap() {
    this.papersById = new Map();
    for (const paper of this.doc?.papers ?? []) {
      if (paper && typeof paper.id === "string") {
        this.papersById.set(paper.id, paper);
      }
    }
  }
}

export const store = new IndexStore();
