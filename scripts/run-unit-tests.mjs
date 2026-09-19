import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const unitTestDirectory = path.resolve("test/unit");
const entries = await readdir(unitTestDirectory, { withFileTypes: true });
const testFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join("test/unit", entry.name))
  .sort();

if (testFiles.length === 0) {
  throw new Error("No unit test files were found in test/unit.");
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
