import { spawnSync } from "node:child_process";
import path from "node:path";

const playwrightCli = path.resolve("node_modules/playwright/cli.js");
const result = spawnSync(process.execPath, [playwrightCli, "install", "chromium"], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
