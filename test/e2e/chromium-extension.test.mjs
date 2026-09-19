import assert from "node:assert/strict";
import test from "node:test";
import { launchExtension } from "../helpers/extension-fixture.mjs";

async function text(page, selector) {
  return (await page.locator(selector).textContent())?.trim() || "";
}

async function message(page, request) {
  return page.evaluate(
    (payload) => new Promise((resolve) => chrome.runtime.sendMessage(payload, resolve)),
    request
  );
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

test("[F-TIMER-01] [F-TIMER-04] the popup records a timer block that the dashboard displays", async (t) => {
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

  await dashboard.waitForFunction(
    () => document.getElementById("range-preset")?.value === "this-week"
  );
  await dashboard.locator("#range-preset").selectOption("all");
  await dashboard.locator("#add-log-button").click();
  await dashboard.locator("#task-name").fill("Planning");
  await dashboard.locator("#task-start-date").fill(start.date);
  await dashboard.locator("#task-start-time").fill(start.time);
  await dashboard.locator("#task-duration-time").fill("02:30");
  await dashboard.locator("#task-duration-time").blur();
  await dashboard.locator("#save-log-button").click();

  await dashboard.waitForFunction(
    () => document.getElementById("kpi-total-time")?.textContent?.trim() === "2h 30m 0s"
  );
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

test("[F-DASH-04] [F-DASH-05] [F-DASH-06] [F-DASH-07] [F-SYNC-02] dashboard remembers ranges and correctly renders grouped, paginated, newest-first local data", async (t) => {
  const extension = await launchExtension();
  t.after(() => extension.close());
  const dashboard = await extension.newExtensionPage("time_manager.html");

  await dashboard.waitForFunction(
    () => document.getElementById("range-preset")?.value === "this-week"
  );
  await dashboard.locator("#range-preset").selectOption("yesterday");
  const reopenedDashboard = await extension.newExtensionPage("time_manager.html");
  await reopenedDashboard.waitForFunction(
    () => document.getElementById("range-preset")?.value === "yesterday"
  );
  assert.equal(await reopenedDashboard.locator("#range-preset").inputValue(), "yesterday");

  const startMs = Date.now() - 6 * 60 * 60 * 1000;
  const definitions = [
    ["Task A", "Alpha", 60],
    ["Task A", "Alpha", 60],
    ["Task A", "Beta", 30],
    ["Task B", "", 30],
    ["Task C", "", 30],
    ["Task D", "", 30],
    ["Task E", "", 30],
  ];
  for (const [index, [taskName, snCommentText, durationMinutes]] of definitions.entries()) {
    const response = await message(reopenedDashboard, {
      action: "saveManualSession",
      taskData: {
        taskName,
        snCommentText,
        startTimeMs: startMs + index * 1000,
        taskDuration: durationMinutes * 60 * 1000,
      },
    });
    assert.equal(response.status, "success");
  }
  assert.equal(
    (await message(reopenedDashboard, {
      action: "servicenow/saveConfig",
      config: { enabled: true, instanceUrl: "https://example.service-now.com", notesSuggestionWeeks: 4 },
    })).status,
    "success"
  );

  await reopenedDashboard.reload();
  await reopenedDashboard.locator("#range-preset").selectOption("all");
  await reopenedDashboard.waitForFunction(
    () => document.getElementById("kpi-block-count")?.textContent?.trim() === "7"
  );
  assert.equal(await text(reopenedDashboard, "#kpi-total-time"), "4h 30m 0s");
  assert.equal(await text(reopenedDashboard, "#kpi-task-count"), "6");
  assert.equal(await text(reopenedDashboard, "#kpi-block-count"), "7");
  assert.equal(await text(reopenedDashboard, "#kpi-avg-block"), "0h 38m 34s");
  assert.match(await text(reopenedDashboard, "#task-log-table tbody"), /Alpha/);
  assert.match(await text(reopenedDashboard, "#task-log-table tbody"), /Beta/);
  await reopenedDashboard.locator("#period-type").selectOption("week");
  assert.match(await text(reopenedDashboard, "#period-summary-table tbody"), /4h 30m 0s/);

  assert.equal(await reopenedDashboard.locator("#task-page-info").textContent(), "Page 1 of 2");
  await reopenedDashboard.locator("#task-page-next").click();
  assert.equal(await reopenedDashboard.locator("#task-page-info").textContent(), "Page 2 of 2");
  assert.match(await text(reopenedDashboard, "#task-log-table tbody"), /Task E/);
  assert.equal(await reopenedDashboard.locator("#toggle-blocks-button").getAttribute("aria-expanded"), "false");
  await reopenedDashboard.locator("#toggle-blocks-button").click();
  assert.equal(await reopenedDashboard.locator("#toggle-blocks-button").getAttribute("aria-expanded"), "true");
  assert.equal(await reopenedDashboard.locator("#block-page-info").textContent(), "Page 1 of 2");
  assert.match((await reopenedDashboard.locator("#block-log-table tbody tr").first().textContent()) || "", /Task E/);
  await reopenedDashboard.locator("#block-page-next").click();
  assert.equal(await reopenedDashboard.locator("#block-page-info").textContent(), "Page 2 of 2");

  await reopenedDashboard.locator("#servicenow-tab-button").click();
  await reopenedDashboard.locator("#sn-sync-range-preset").selectOption("today");
  assert.equal(await text(reopenedDashboard, "#sn-sync-range-preview"), "7 blocks will be synced");
});
