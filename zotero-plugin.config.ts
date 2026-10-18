import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  server: {
    // Dev instance uses an isolated profile/data dir and must never write the
    // real papers_index.json; point it at the working copy instead.
    prefs: {
      "extensions.zotero.paperstatus.jsonPath":
        "C:\\Users\\35150\\Desktop\\学习资料\\paper\\papers_index.COPY.json",
    },
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
    mocha: {
      timeout: 20000,
    },
    prefs: {
      // Cross-platform placeholder: the test suite creates and points at its
      // own per-run fixture directory (see test/paper-status.test.ts).
      "extensions.zotero.paperstatus.jsonPath": join(
        tmpdir(),
        "zotero-paperstatus-test",
        "papers_index.COPY.json",
      ),
    },
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
