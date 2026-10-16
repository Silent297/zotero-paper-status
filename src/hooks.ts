import {
  registerColumns,
  startPolling,
  unregisterColumns,
} from "./modules/columns";
import { store } from "./modules/indexStore";
import { rebuildMatchMap } from "./modules/matcher";
import { initLocale } from "./utils/locale";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  await store.load();
  try {
    await rebuildMatchMap();
  } catch (e) {
    Zotero.debug(`[zotero-paper-status] match map failed: ${e}`);
  }

  registerColumns();
  startPolling();

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(_win: _ZoteroTypes.MainWindow): Promise<void> {
  // Columns are managed globally via Zotero.ItemTreeManager; nothing per-window.
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  // Nothing per-window.
}

function onShutdown(): void {
  try {
    unregisterColumns();
  } catch (e) {
    Zotero.debug(`[zotero-paper-status] shutdown cleanup failed: ${e}`);
  }
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
