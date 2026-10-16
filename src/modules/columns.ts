import { FluentMessageId } from "../../typings/i10n";
import { getString } from "../utils/locale";
import {
  INTENT_CYCLE,
  PaperEntry,
  READING_CYCLE,
  SHARE_CYCLE,
  StatusField,
  store,
} from "./indexStore";
import { paperIdForItem, rebuildMatchMap } from "./matcher";

interface ColumnDef {
  field: StatusField;
  labelKey: FluentMessageId;
  labelFallback: string;
  width: string;
}

const COLUMN_DEFS: ColumnDef[] = [
  {
    field: "reading",
    labelKey: "column-reading",
    labelFallback: "阅读",
    width: "80",
  },
  {
    field: "intent",
    labelKey: "column-intent",
    labelFallback: "意愿",
    width: "80",
  },
  {
    field: "share",
    labelKey: "column-share",
    labelFallback: "分享",
    width: "80",
  },
  {
    field: "star",
    labelKey: "column-star",
    labelFallback: "星标",
    width: "48",
  },
];

const registeredKeys: string[] = [];
let pollTimer: ReturnType<typeof setInterval> | undefined;
let notifierID: string | undefined;
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
let rebuildRunning = false;
let writeBusy = false;

function log(message: string) {
  Zotero.debug(`[zotero-paper-status] ${message}`);
}

function text(key: FluentMessageId, fallback: string): string {
  try {
    const value = getString(key);
    if (value && !value.startsWith(`${addon.data.config.addonRef}-`)) {
      return value;
    }
  } catch {
    // locale not ready yet, use the fallback
  }
  return fallback;
}

/**
 * Zotero's pluginAPIBase wraps renderCell in an arrow function, so the item
 * tree's `this` binding never reaches it (the `apply(this, ...)` in
 * itemTree.js:_renderCell is discarded). The cell data string is the only
 * per-row channel that survives into renderCell, so the paper id travels
 * with it after a zero-width space (invisible when rendered or sorted).
 */
export const CELL_DATA_SEPARATOR = "\u200B";

export function splitCellData(
  data: string,
): { display: string; paperId: string } | null {
  if (!data) {
    return null;
  }
  const index = data.lastIndexOf(CELL_DATA_SEPARATOR);
  if (index < 0) {
    return null;
  }
  const paperId = data.slice(index + CELL_DATA_SEPARATOR.length);
  if (!paperId) {
    return null;
  }
  return { display: data.slice(0, index), paperId };
}

function dataForItem(item: Zotero.Item, field: StatusField): string {
  if (!item || !item.id) {
    return "";
  }
  const paperId = paperIdForItem(item.id);
  if (!paperId) {
    return "";
  }
  return `${store.getDisplay(paperId, field)}${CELL_DATA_SEPARATOR}${paperId}`;
}

function applyStyle(cell: HTMLElement, field: StatusField, value: string) {
  switch (field) {
    case "reading":
      cell.style.color =
        value === "已读" ? "#1a7f37" : value === "在读" ? "#b26a00" : "#8a8a8a";
      break;
    case "intent":
      cell.style.color =
        value === "精读" ? "#8250df" : value === "速读" ? "#0969da" : "#8a8a8a";
      if (value === "不读") {
        cell.style.textDecoration = "line-through";
      }
      if (value === "未标") {
        cell.style.opacity = "0.6";
      }
      break;
    case "share":
      cell.style.color =
        value === "已分享"
          ? "#1a7f37"
          : value === "已预订"
            ? "#b26a00"
            : "#8a8a8a";
      break;
    case "star":
      cell.style.color = value === "★" ? "#d4a017" : "#8a8a8a";
      break;
  }
}

function nextValue(field: StatusField, entry: PaperEntry): string | boolean {
  if (field === "star") {
    return entry.star !== true;
  }
  const current = String(entry[field] ?? "");
  const cycle =
    field === "reading"
      ? READING_CYCLE
      : field === "intent"
        ? INTENT_CYCLE
        : SHARE_CYCLE;
  const index = cycle.indexOf(current);
  return cycle[(index < 0 ? 0 : index + 1) % cycle.length];
}

async function cycleStatus(paperId: string, field: StatusField) {
  if (writeBusy) {
    return;
  }
  const entry = store.getPaper(paperId);
  if (!entry) {
    return;
  }
  const next = nextValue(field, entry);
  writeBusy = true;
  try {
    const ok = await store.setValue(paperId, field, next);
    if (ok) {
      Zotero.ItemTreeManager.refreshColumns();
    }
  } finally {
    writeBusy = false;
  }
}

function makeRenderer(field: StatusField) {
  return function renderCell(
    _index: number,
    data: string,
    column: _ZoteroTypes.ItemTreeManager.ItemTreeColumnOptions & {
      className: string;
    },
    _isFirstColumn: boolean,
    doc: Document,
  ): HTMLElement {
    const cell = doc.createElement("span");
    cell.className = `cell ${column.className ?? ""}`;
    cell.style.display = "inline-block";
    cell.style.padding = "0 2px";
    const parsed = splitCellData(data);
    if (!parsed) {
      cell.textContent = "";
      return cell;
    }
    cell.textContent = parsed.display;
    cell.title = text("cell-tooltip", "点击切换状态");
    cell.style.cursor = "pointer";
    applyStyle(cell, field, parsed.display);
    cell.addEventListener("click", (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      void cycleStatus(parsed.paperId, field);
    });
    return cell;
  };
}

export function registerColumns(): void {
  for (const def of COLUMN_DEFS) {
    try {
      const key = Zotero.ItemTreeManager.registerColumn({
        dataKey: def.field,
        label: text(def.labelKey, def.labelFallback),
        pluginID: addon.data.config.addonID,
        enabledTreeIDs: ["main"],
        defaultIn: ["*"],
        flex: 0,
        width: def.width,
        minWidth: 48,
        showInColumnPicker: true,
        dataProvider: (item: Zotero.Item, _dataKey: string) =>
          dataForItem(item, def.field),
        renderCell: makeRenderer(def.field),
        zoteroPersist: ["width", "hidden", "sortDirection"],
      });
      if (key) {
        registeredKeys.push(key);
      } else {
        log(`registerColumn(${def.field}) returned false`);
      }
    } catch (e) {
      log(`registerColumn(${def.field}) failed: ${e}`);
    }
  }
  Zotero.ItemTreeManager.refreshColumns();
}

export function unregisterColumns(): void {
  stopPolling();
  for (const key of registeredKeys.splice(0)) {
    try {
      Zotero.ItemTreeManager.unregisterColumn(key);
    } catch (e) {
      log(`unregisterColumn failed: ${e}`);
    }
  }
  Zotero.ItemTreeManager.refreshColumns();
}

export function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, 3000);
  // Re-match when items are added/changed in the library, so newly imported
  // papers show their status without restarting Zotero.
  try {
    notifierID = Zotero.Notifier.registerObserver(
      { notify: () => scheduleRebuild() },
      ["item"],
      "paperstatus",
    );
  } catch (e) {
    log(`notifier registration failed: ${e}`);
  }
}

export function stopPolling(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
  if (notifierID !== undefined) {
    try {
      Zotero.Notifier.unregisterObserver(notifierID);
    } catch (e) {
      log(`notifier unregistration failed: ${e}`);
    }
    notifierID = undefined;
  }
  if (rebuildTimer !== undefined) {
    clearTimeout(rebuildTimer);
    rebuildTimer = undefined;
  }
}

function scheduleRebuild() {
  // Reset on every event: an import burst produces one rebuild 1s after the
  // last change instead of a rebuild mid-burst with half-populated items.
  if (rebuildTimer !== undefined) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = undefined;
    void rebuildAndRefresh();
  }, 1000);
}

async function rebuildAndRefresh(): Promise<void> {
  if (rebuildRunning) {
    scheduleRebuild();
    return;
  }
  rebuildRunning = true;
  try {
    await rebuildMatchMap();
    Zotero.ItemTreeManager.refreshColumns();
  } catch (e) {
    log(`match rebuild failed: ${e}`);
  } finally {
    rebuildRunning = false;
  }
}

async function pollOnce(): Promise<void> {
  try {
    const win = Zotero.getMainWindow();
    if (!win || !win.document.hasFocus()) {
      return;
    }
    const changed = await store.checkForChanges();
    if (changed) {
      await rebuildMatchMap();
      Zotero.ItemTreeManager.refreshColumns();
    }
  } catch (e) {
    log(`poll failed: ${e}`);
  }
}
