import { assert } from "chai";
import { config } from "../package.json";
import { splitCellData } from "../src/modules/columns";
import { store } from "../src/modules/indexStore";

const PREF_JSON_PATH = "extensions.zotero.paperstatus.jsonPath";
const ADDON_ID = config.addonID;
const READING_CYCLE = ["未读", "在读", "已读"];
const INTENT_CYCLE = ["", "不读", "速读", "精读"];
const SHARE_CYCLE = ["未安排", "已预订", "已分享"];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string) {
  Zotero.debug(`[paper-status-test] ${message}`);
}

function ourColumns(): any[] {
  return (Zotero.ItemTreeManager as any)
    .getCustomColumns()
    .filter((column: any) => column.pluginID === ADDON_ID);
}

function columnFor(field: string): any {
  const column = ourColumns().find((candidate: any) =>
    String(candidate.dataKey).endsWith(`-${field}`),
  );
  assert.isOk(column, `column ${field} is not registered`);
  return column;
}

function cellDataFor(item: any, field: string): string {
  const column = columnFor(field);
  return column.dataProvider(item, column.dataKey);
}

async function waitFor<T>(
  fn: () => T | Promise<T>,
  what: string,
  timeout = 20000,
  interval = 200,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    let value: T | undefined;
    try {
      value = await fn();
    } catch (e) {
      log(`waitFor(${what}) attempt threw: ${e}`);
    }
    if (value) {
      return value;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await sleep(interval);
  }
}

function nextInCycle(cycle: string[], current: string): string {
  const index = cycle.indexOf(current);
  return cycle[(index < 0 ? 0 : index + 1) % cycle.length];
}

function normalizeDoc(doc: any): any {
  const copy = JSON.parse(JSON.stringify(doc));
  delete copy.updated;
  return copy;
}

function diffLineIndexes(before: string, after: string): number[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const indexes: number[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      indexes.push(i);
    }
  }
  return indexes;
}

describe("paper status plugin", function () {
  this.timeout(60000);

  let prefPath: string;
  let jsonDir: string;
  let initialDoc: any;
  let paper: any;
  let titleItem: any;
  let fileItem: any;
  let linkedItem: any;
  let strangerItem: any;

  async function readRaw(): Promise<string> {
    return IOUtils.readUTF8(prefPath);
  }

  function paperById(doc: any, id: string): any {
    return doc.papers.find((entry: any) => entry && entry.id === id);
  }

  function renderCellOf(field: string, item: any): any {
    const column = columnFor(field);
    const data = column.dataProvider(item, column.dataKey);
    const cell = column.renderCell(
      0,
      data,
      { ...column, className: "cell" },
      false,
      document,
    );
    return { cell, data, column };
  }

  before(async function () {
    prefPath = Zotero.Prefs.get(PREF_JSON_PATH, true) as string;
    assert.include(
      prefPath,
      "papers_index.COPY.json",
      "tests must target the COPY file, never the real papers_index.json",
    );
    jsonDir = PathUtils.parent(prefPath) as string;
    initialDoc = JSON.parse(await readRaw());

    let absPdf = "";
    for (const candidate of initialDoc.papers) {
      if (!candidate || !candidate.path || !candidate.file) {
        continue;
      }
      const absolute = `${jsonDir}\\${String(candidate.path).replace(/\//g, "\\")}`;
      if (await IOUtils.exists(absolute)) {
        paper = candidate;
        absPdf = absolute;
        break;
      }
    }
    assert.isOk(paper, "no paper with an existing PDF found in the index");
    log(`seeding with paper ${paper.id} (${paper.file})`);

    titleItem = new Zotero.Item("document");
    titleItem.setField("title", String(paper.title));
    await titleItem.saveTx();

    fileItem = await Zotero.Attachments.importFromFile({
      file: absPdf,
      libraryID: Zotero.Libraries.userLibraryID,
    });

    linkedItem = await Zotero.Attachments.linkFromFile({
      file: absPdf,
      libraryID: Zotero.Libraries.userLibraryID,
    });

    strangerItem = new Zotero.Item("document");
    strangerItem.setField("title", `zz-unmatched-${Date.now()}`);
    await strangerItem.saveTx();

    await waitFor(
      () =>
        (cellDataFor(titleItem, "reading") &&
          cellDataFor(fileItem, "reading") &&
          cellDataFor(linkedItem, "reading")) ||
        undefined,
      "match map rebuild for all seeded items",
      30000,
    );
  });

  it("registers four status columns with labels", function () {
    const columns = ourColumns();
    assert.equal(columns.length, 4);
    const expectations: Array<[string, RegExp]> = [
      ["reading", /阅读|Reading/],
      ["intent", /意愿|Intent/],
      ["share", /分享|Shared/],
      ["star", /星标|Star/],
    ];
    const keys = new Set<string>();
    for (const [field, labelRe] of expectations) {
      const column = columnFor(field);
      assert.match(String(column.label), labelRe);
      assert.isTrue(String(column.dataKey).startsWith("zotero-paper-status"));
      assert.isTrue(column.showInColumnPicker !== false);
      keys.add(String(column.dataKey));
    }
    assert.equal(keys.size, 4);
  });

  it("maps library items to papers and leaves unmatched rows empty", function () {
    const expectedReading = String(paper.reading ?? "未读");
    for (const [item, what] of [
      [titleItem, "title match"],
      [fileItem, "filename match"],
      [linkedItem, "absolute path match"],
    ] as Array<[any, string]>) {
      const parsed = splitCellData(cellDataFor(item, "reading"));
      assert.isOk(parsed, `${what} should carry a paper id`);
      assert.equal(parsed!.paperId, paper.id);
      assert.equal(parsed!.display, expectedReading);
    }
    const starParsed = splitCellData(cellDataFor(titleItem, "star"));
    assert.equal(starParsed!.display, paper.star === true ? "★" : "☆");
    assert.equal(cellDataFor(strangerItem, "reading"), "");
  });

  it("renderCell returns an Element and an empty cell for unmatched rows", function () {
    const { cell, data } = renderCellOf("reading", titleItem);
    assert.instanceOf(cell, window.Element);
    assert.equal(cell.textContent, splitCellData(data)!.display);
    assert.equal(cell.style.cursor, "pointer");
    assert.isOk(cell.title);

    const column = columnFor("reading");
    const empty = column.renderCell(
      0,
      "",
      { ...column, className: "cell" },
      false,
      document,
    );
    assert.instanceOf(empty, window.Element);
    assert.equal(empty.textContent, "");
  });

  it("clicking the reading cell cycles values with a minimal JSON diff", async function () {
    const onDisk0 = await readRaw();
    const doc0 = JSON.parse(onDisk0);
    const current = String(paperById(doc0, paper.id).reading ?? "未读");
    const { cell } = renderCellOf("reading", titleItem);

    let expectedValue = current;
    let firstWrite: string | undefined;
    for (let click = 1; click <= 3; click++) {
      expectedValue = nextInCycle(READING_CYCLE, expectedValue);
      const expected = expectedValue;
      cell.click();
      const raw = await waitFor(async () => {
        const text = await readRaw();
        const parsed = JSON.parse(text);
        return paperById(parsed, paper.id).reading === expected ? text : undefined;
      }, `reading to become ${expected}`);
      if (click === 1) {
        firstWrite = raw;
      }
      await sleep(250);
    }

    const finalDoc = JSON.parse(await readRaw());
    assert.equal(
      paperById(finalDoc, paper.id).reading,
      current,
      "full cycle returns to the original value",
    );

    const diffs = diffLineIndexes(onDisk0, firstWrite!);
    const beforeLines = onDisk0.split("\n");
    const afterLines = firstWrite!.split("\n");
    assert.isAtMost(
      diffs.length,
      2,
      `unexpected diff lines: ${diffs.map((i) => afterLines[i]).join(" | ")}`,
    );
    for (const i of diffs) {
      const line = afterLines[i];
      assert.isTrue(
        line.includes(`"reading":`) || line.trimStart().startsWith(`"updated":`),
        `only reading/updated may change, got: ${line} (was: ${beforeLines[i]})`,
      );
    }
    assert.deepEqual(normalizeDoc(finalDoc), normalizeDoc(doc0));
  });

  it("toggles the star cell and keeps the rest of the file intact", async function () {
    const before = await readRaw();
    const beforeDoc = JSON.parse(before);
    const beforeStar = paperById(beforeDoc, paper.id).star === true;
    const { cell } = renderCellOf("star", titleItem);

    cell.click();
    await waitFor(async () => {
      const parsed = JSON.parse(await readRaw());
      return paperById(parsed, paper.id).star === !beforeStar;
    }, `star to become ${!beforeStar}`);
    await sleep(250);

    const afterDoc = JSON.parse(await readRaw());
    const fixed = JSON.parse(JSON.stringify(afterDoc));
    paperById(fixed, paper.id).star = beforeStar;
    assert.deepEqual(normalizeDoc(fixed), normalizeDoc(beforeDoc));
    const parsed = splitCellData(cellDataFor(titleItem, "star"));
    assert.equal(parsed!.display, !beforeStar ? "★" : "☆");
  });

  it("cycles the intent cell", async function () {
    const before = await readRaw();
    const beforeDoc = JSON.parse(before);
    const current = String(paperById(beforeDoc, paper.id).intent ?? "");
    const expected = nextInCycle(INTENT_CYCLE, current);
    const { cell } = renderCellOf("intent", titleItem);

    cell.click();
    const after = await waitFor(async () => {
      const text = await readRaw();
      const parsed = JSON.parse(text);
      return paperById(parsed, paper.id).intent === expected ? text : undefined;
    }, `intent to become "${expected}"`);
    await sleep(250);

    const fixedIntent = JSON.parse(after);
    paperById(fixedIntent, paper.id).intent = current;
    assert.deepEqual(normalizeDoc(fixedIntent), normalizeDoc(beforeDoc));
    assert.equal(
      splitCellData(cellDataFor(titleItem, "intent"))!.display,
      expected === "" ? "未标" : expected,
    );
  });

  it("cycles the share cell", async function () {
    const before = await readRaw();
    const beforeDoc = JSON.parse(before);
    const current = String(paperById(beforeDoc, paper.id).share ?? "未安排");
    const expected = nextInCycle(SHARE_CYCLE, current);
    const { cell } = renderCellOf("share", titleItem);

    cell.click();
    const after = await waitFor(async () => {
      const text = await readRaw();
      const parsed = JSON.parse(text);
      return paperById(parsed, paper.id).share === expected ? text : undefined;
    }, `share to become "${expected}"`);
    await sleep(250);

    const fixedShare = JSON.parse(after);
    paperById(fixedShare, paper.id).share = current;
    assert.deepEqual(normalizeDoc(fixedShare), normalizeDoc(beforeDoc));
    assert.equal(
      splitCellData(cellDataFor(titleItem, "share"))!.display,
      expected,
    );
  });

  it("degrades gracefully on missing and corrupt files", async function () {
    const beforeRaw = await readRaw();
    assert.isTrue(await store.load());
    const shownReading = store.getDisplay(paper.id, "reading");
    assert.isOk(shownReading);

    const missingPath = `${jsonDir}\\definitely-not-a-file-${Date.now()}.json`;
    Zotero.Prefs.set(PREF_JSON_PATH, missingPath, true);
    assert.isFalse(await store.load(), "load should fail for a missing file");
    assert.equal(
      store.getDisplay(paper.id, "reading"),
      shownReading,
      "keeps last good data after a failed load",
    );
    assert.isFalse(
      await store.setValue(paper.id, "reading", "在读"),
      "no write while the file is missing",
    );

    const badPath = `${Zotero.DataDirectory.dir}\\paper-status-bad-${Date.now()}.json`;
    const badContent = "{ not valid json ";
    await IOUtils.writeUTF8(badPath, badContent);
    Zotero.Prefs.set(PREF_JSON_PATH, badPath, true);
    assert.isFalse(await store.load(), "load should fail for a corrupt file");
    assert.isFalse(
      await store.setValue(paper.id, "reading", "在读"),
      "no write while the file is corrupt",
    );
    assert.equal(
      await IOUtils.readUTF8(badPath),
      badContent,
      "corrupt file untouched by failed writes",
    );
    await IOUtils.remove(badPath, { ignoreAbsent: true });

    Zotero.Prefs.set(PREF_JSON_PATH, prefPath, true);
    assert.isTrue(await store.load(), "load recovers once the good path is back");
    assert.equal(
      await readRaw(),
      beforeRaw,
      "the good file is byte-identical after the degradation exercise",
    );
    assert.isFalse(await IOUtils.exists(`${prefPath}.tmp`));
  });

  it("unregisters columns on shutdown and restores them on startup", async function () {
    const instance: any = (Zotero as any)[config.addonInstance];
    assert.isOk(instance, "plugin instance");
    instance.hooks.onShutdown();
    assert.equal(ourColumns().length, 0, "columns removed on shutdown");

    await instance.hooks.onStartup();
    (Zotero as any)[config.addonInstance] = instance;
    assert.equal(ourColumns().length, 4, "columns restored on startup");
    const parsed = splitCellData(cellDataFor(titleItem, "reading"));
    assert.isOk(parsed, "rows are mapped again after restart");
    assert.equal(parsed!.paperId, paper.id);
  });
});
