import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const projectRoot = path.resolve(import.meta.dirname, "../..");

async function getServiceWorker(context) {
  const existing = context.serviceWorkers()[0];
  return existing || context.waitForEvent("serviceworker");
}

export async function launchExtension() {
  const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "time-manager-test-"));
  const context = await chromium.launchPersistentContext(userDataDirectory, {
    channel: "chromium",
    headless: process.env.TM_TEST_HEADED !== "1",
    args: [
      `--disable-extensions-except=${projectRoot}`,
      `--load-extension=${projectRoot}`,
    ],
  });
  const worker = await getServiceWorker(context);
  const extensionId = new URL(worker.url()).host;

  return {
    async newExtensionPage(pageName) {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${pageName}`);
      return page;
    },
    async close() {
      await context.close();
      await rm(userDataDirectory, { recursive: true, force: true });
    },
  };
}
