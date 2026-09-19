import { spawnSync } from "node:child_process";
import path from "node:path";

const webExtCli = path.resolve("node_modules/web-ext/bin/web-ext.js");
const commands = [
  [process.execPath, ["scripts/check.mjs"]],
  [process.execPath, ["scripts/check-functional-coverage.mjs"]],
  [process.execPath, ["scripts/run-unit-tests.mjs"]],
  [process.execPath, [webExtCli, "lint", "--source-dir", "."]],
  [process.execPath, ["scripts/run-chromium-tests.mjs"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
