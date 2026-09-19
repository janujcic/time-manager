import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadBackground } from "../helpers/load-background.mjs";

const runtimeFiles = [
  "background.js",
  "main_window.js",
  "time_manager.js",
  "sn_content_bridge.js",
  "sn_page_bridge.js",
];

async function readRuntimeSources() {
  return Object.fromEntries(await Promise.all(runtimeFiles.map(async (file) => [file, await readFile(file, "utf8")])));
}

test("[F-SN-06] only the page bridge makes ServiceNow network requests and stored configuration has no credential fields", async () => {
  const sources = await readRuntimeSources();
  for (const [file, source] of Object.entries(sources)) {
    if (file !== "sn_page_bridge.js") {
      assert.doesNotMatch(source, /\bfetch\s*\(/, `${file} must not make a network request.`);
    }
  }
  assert.match(sources["background.js"], /const DEFAULT_SN_CONFIG = \{[\s\S]*enabled:[\s\S]*instanceUrl:[\s\S]*defaultRateTypeSysId:[\s\S]*notesSuggestionWeeks:/);
  const { api, storage } = await loadBackground();
  await api.saveConfig({
    enabled: true,
    instanceUrl: "https://example.service-now.com",
    password: "must-not-persist",
    csrfToken: "must-not-persist",
  });
  assert.deepEqual(storage.snapshot().sn_config, {
    enabled: true,
    instanceUrl: "https://example.service-now.com",
    defaultRateTypeSysId: "",
    notesSuggestionWeeks: 4,
  });
});

test("[F-LIMIT-01] [F-LIMIT-02] local storage has no export/import, cloud-backup, undo, or archive feature path", async () => {
  const sources = await readRuntimeSources();
  const productSources = [sources["background.js"], sources["main_window.js"], sources["time_manager.js"]].join("\n");
  assert.doesNotMatch(productSources, /\b(export|import|backup|archive|undo)\b/i);
  assert.match(sources["background.js"], /chrome\.storage\.local/);
});
