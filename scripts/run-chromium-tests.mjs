import { spawnSync } from "node:child_process";

const headed = process.argv.includes("--headed");
const result = spawnSync(process.execPath, ["--test", "test/e2e/chromium-extension.test.mjs"], {
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: "0",
    ...(headed ? { TM_TEST_HEADED: "1" } : {}),
  },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
