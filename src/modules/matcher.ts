import { store } from "./indexStore";

/** Same normalization as zotero_import_memory.py#norm_title. */
export function normTitle(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normPath(value: string): string {
  return value.replace(/\//g, "\\").toLowerCase();
}

let itemToPaper = new Map<number, string>();
let paperToItems = new Map<string, number[]>();

export function paperIdForItem(itemID: number): string | undefined {
  return itemToPaper.get(itemID);
}

export function itemIDsForPaper(paperId: string): number[] {
  return paperToItems.get(paperId) ?? [];
}

function log(message: string) {
  Zotero.debug(`[zotero-paper-status] ${message}`);
}

async function filePathOf(attachment: Zotero.Item): Promise<string | false> {
  try {
    return await attachment.getFilePathAsync();
  } catch {
    return false;
  }
}

async function matchAttachment(
  attachment: Zotero.Item,
  byPath: Map<string, string>,
  byFile: Map<string, string>,
): Promise<string | undefined> {
  const filePath = await filePathOf(attachment);
  if (filePath) {
    const hit = byPath.get(normPath(filePath));
    if (hit) {
      return hit;
    }
  }
  const name = attachment.attachmentFilename;
  if (name) {
    const hit = byFile.get(String(name).toLowerCase());
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

async function matchRegularItem(
  item: Zotero.Item,
  byPath: Map<string, string>,
  byFile: Map<string, string>,
): Promise<string | undefined> {
  const attachmentIDs = item.getAttachments();
  const attachments: Zotero.Item[] = [];
  for (const id of attachmentIDs) {
    const attachment = Zotero.Items.get(id);
    if (attachment) {
      attachments.push(attachment);
    }
  }
  // Precedence: absolute file path first, then file name
  for (const attachment of attachments) {
    const filePath = await filePathOf(attachment);
    if (filePath) {
      const hit = byPath.get(normPath(filePath));
      if (hit) {
        return hit;
      }
    }
  }
  for (const attachment of attachments) {
    const name = attachment.attachmentFilename;
    if (name) {
      const hit = byFile.get(String(name).toLowerCase());
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

/**
 * Maps library items to papers_index.json entries.
 * Order of precedence: linked/stored absolute path > file name > title > short title.
 * Unmatched items render empty cells.
 * New maps are built locally and swapped in at the end, so concurrent
 * lookups never observe a half-rebuilt (empty) mapping.
 */
export async function rebuildMatchMap(): Promise<string> {
  const nextItemToPaper = new Map<number, string>();
  const nextPaperToItems = new Map<string, number[]>();
  const link = (itemID: number, paperId: string) => {
    if (nextItemToPaper.has(itemID)) {
      return;
    }
    nextItemToPaper.set(itemID, paperId);
    const existing = nextPaperToItems.get(paperId);
    if (existing) {
      existing.push(itemID);
    } else {
      nextPaperToItems.set(paperId, [itemID]);
    }
  };

  const papers = store.getPapers();
  const jsonDir = PathUtils.parent(store.path) ?? "";
  const byTitle = new Map<string, string>();
  const byFile = new Map<string, string>();
  const byPath = new Map<string, string>();

  for (const paper of papers) {
    if (!paper || typeof paper.id !== "string") {
      continue;
    }
    if (paper.title) {
      byTitle.set(normTitle(paper.title), paper.id);
    }
    // Short titles bridge items whose stored PDF copy was renamed and whose
    // item title was shortened (e.g. item "Dream-RSI" vs full paper title).
    if (paper.short) {
      const key = normTitle(String(paper.short));
      if (key && !byTitle.has(key)) {
        byTitle.set(key, paper.id);
      }
    }
    if (paper.file) {
      byFile.set(String(paper.file).toLowerCase(), paper.id);
    }
    const relative = String(paper.path || paper.id);
    if (jsonDir && relative) {
      const separator = jsonDir.endsWith("\\") ? "" : "\\";
      byPath.set(
        normPath(`${jsonDir}${separator}${relative.replace(/\//g, "\\")}`),
        paper.id,
      );
    }
  }

  let items: Zotero.Item[];
  try {
    items = await Zotero.Items.getAll(
      Zotero.Libraries.userLibraryID,
      false,
      false,
    );
  } catch (e) {
    log(`failed to enumerate library items: ${e}`);
    return "match failed: cannot enumerate library items";
  }

  const unmatchedItems: string[] = [];
  let mappedItems = 0;

  for (const item of items) {
    if (!item || nextItemToPaper.has(item.id)) {
      continue;
    }
    let paperId: string | undefined;
    if (item.isRegularItem()) {
      paperId = await matchRegularItem(item, byPath, byFile);
      if (!paperId) {
        const title = String(item.getField("title") || "");
        if (title) {
          paperId = byTitle.get(normTitle(title));
        }
      }
      if (paperId) {
        link(item.id, paperId);
        mappedItems++;
        for (const attachmentID of item.getAttachments()) {
          link(attachmentID, paperId);
        }
      } else if (unmatchedItems.length < 10) {
        const title = String(item.getField("title") || "(untitled)");
        unmatchedItems.push(title.slice(0, 60));
      }
    } else if (item.isAttachment()) {
      paperId = await matchAttachment(item, byPath, byFile);
      if (paperId) {
        link(item.id, paperId);
        mappedItems++;
      }
    }
  }

  itemToPaper = nextItemToPaper;
  paperToItems = nextPaperToItems;

  const summary =
    `match: ${paperToItems.size}/${papers.length} papers, ${mappedItems} top-level items mapped, ` +
    `${unmatchedItems.length}${unmatchedItems.length >= 10 ? "+" : ""} unmatched items` +
    (unmatchedItems.length ? `; e.g. ${unmatchedItems.join(" | ")}` : "");
  log(summary);
  return summary;
}
