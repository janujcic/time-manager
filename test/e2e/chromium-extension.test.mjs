import assert from "node:assert/strict";
import test from "node:test";
import { launchExtension } from "../helpers/extension-fixture.mjs";

async function text(page, selector) {
  return (await page.locator(selector).textContent())?.trim() || "";
}

function todayAt(hour, minute) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

test("the popup records a timer block that the dashboard displays", async (t) => {
  const extension = await launchExtension();
  t.after(() => extension.close());

  const popup = await extension.newExtensionPage("main_window.html");
  await popup.locator("#main-sn-assignment-input").fill("Focus on tests");
  await popup.locator("#start-button").click();
  await popup.locator(".running-task").waitFor({ state: "visible" });
  assert.equal(await text(popup, "#running-task-title"), "Focus on tests");
  assert.equal(await text(popup, "#running-task-message"), "Status: Running");

  await popup.waitForTimeout(20);
  await popup.locator("#stop-button").click();
  await popup.waitForFunction(
    () => document.getElementById("running-task-message")?.textContent === "Status: Paused"
  );
  assert.equal(await text(popup, "#running-task-message"), "Status: Paused");

  const dashboard = await extension.newExtensionPage("time_manager.html");
  await dashboard.locator("#range-preset").selectOption("all");
  await dashboard.locator("#kpi-block-count").waitFor({ state: "visible" });
  assert.equal(await text(dashboard, "#kpi-block-count"), "1");
  assert.match(await text(dashboard, "#task-log-table tbody"), /Focus on tests/);

  await popup.locator("#finish-button").click();
  await popup.locator(".enter-start-task").waitFor({ state: "visible" });
  assert.equal(await text(popup, "#elapsed-time"), "0h 0m 0s");
});

test("the dashboard updates user-visible totals when a manual block is added, edited, and removed", async (t) => {
  const extension = await launchExtension();
  t.after(() => extension.close());
  const dashboard = await extension.newExtensionPage("time_manager.html");
  const start = todayAt(9, 0);

  await dashboard.locator("#range-preset").selectOption("all");
  await dashboard.locator("#add-log-button").click();
  await dashboard.locator("#task-name").fill("Planning");
  await dashboard.locator("#task-start-date").fill(start.date);
  await dashboard.locator("#task-start-time").fill(start.time);
  await dashboard.locator("#task-duration-time").fill("02:30");
  await dashboard.locator("#task-duration-time").blur();
  await dashboard.locator("#save-log-button").click();

  await dashboard.locator("#kpi-total-time").waitFor({ state: "visible" });
  assert.equal(await text(dashboard, "#kpi-total-time"), "2h 30m 0s");
  assert.equal(await text(dashboard, "#kpi-task-count"), "1");
  assert.equal(await text(dashboard, "#kpi-block-count"), "1");
  assert.equal(await text(dashboard, "#kpi-avg-block"), "2h 30m 0s");
  assert.match(await text(dashboard, "#task-log-table tbody"), /Planning/);
  assert.match(await text(dashboard, "#period-summary-table tbody"), /2h 30m 0s/);

  await dashboard.locator("#period-type").selectOption("week");
  assert.match(await text(dashboard, "#period-summary-table tbody"), /2h 30m 0s/);
  await dashboard.locator("#range-preset").selectOption("yesterday");
  await dashboard.waitForFunction(
    () => document.getElementById("kpi-block-count")?.textContent?.trim() === "0"
  );
  assert.equal(await text(dashboard, "#kpi-total-time"), "0h 0m 0s");
  await dashboard.locator("#range-preset").selectOption("all");
  await dashboard.waitForFunction(
    () => document.getElementById("kpi-block-count")?.textContent?.trim() === "1"
  );

  await dashboard.locator("#toggle-blocks-button").click();
  await dashboard.locator(".edit-block-button").click();
  await dashboard.locator("#task-duration-time").fill("03:00");
  await dashboard.locator("#task-duration-time").blur();
  await dashboard.locator("#save-log-button").click();
  await dashboard.locator("#kpi-total-time").waitFor({ state: "visible" });
  assert.equal(await text(dashboard, "#kpi-total-time"), "3h 0m 0s");

  await dashboard.locator(".remove-block-button").click();
  await dashboard.locator("#kpi-block-count").waitFor({ state: "visible" });
  assert.equal(await text(dashboard, "#kpi-block-count"), "0");
  assert.equal(await text(dashboard, "#kpi-total-time"), "0h 0m 0s");
});
