import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const javascriptFiles = [
  "background.js",
  "main_window.js",
  "time_manager.js",
  "sn_content_bridge.js",
  "sn_page_bridge.js",
];

async function checkManifest() {
  const rawManifest = await readFile("manifest.json", "utf8");
  const manifest = JSON.parse(rawManifest);
  const requiredFields = ["manifest_version", "name", "version", "background", "action"];
  const missingFields = requiredFields.filter((field) => !manifest[field]);

  if (manifest.manifest_version !== 3) {
    throw new Error("manifest.json must use manifest_version 3.");
  }
  if (missingFields.length > 0) {
    throw new Error(`manifest.json is missing: ${missingFields.join(", ")}.`);
  }
}

function checkJavaScript() {
  for (const file of javascriptFiles) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `Syntax check failed for ${file}.`);
    }
  }
}

await checkManifest();
checkJavaScript();
console.log("Checks passed: manifest and JavaScript syntax are valid.");
