import assert from "node:assert/strict";
import test from "node:test";
import { loadPageBridge } from "../helpers/load-page-bridge.mjs";

function jsonResponse(result) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { result };
    },
    async text() {
      return "";
    },
  };
}

function group(overrides = {}) {
  return {
    groupKey: "group-1",
    weekStartDate: "2026-01-05",
    snSelectionType: "task",
    snTaskSysId: "task-1",
    snCategoryValue: "task_work",
    snCodeSysId: "code-1",
    snRateTypeSysId: "rate-1",
    snCommentText: "Implementation",
    touchedDays: ["monday", "tuesday"],
    dayHours: {
      monday: 1,
      tuesday: 2,
      wednesday: 0,
      thursday: 0,
      friday: 0,
      saturday: 0,
      sunday: 0,
    },
    totalHours: 3,
    comments: ["Implementation"],
    ...overrides,
  };
}

test("[F-SYNC-05] sync creates a time card with the exact grouped hours and metadata", async () => {
  const calls = [];
  const bridge = await loadPageBridge(async (url, options = {}) => {
    calls.push({ url, options: JSON.parse(JSON.stringify(options)) });
    if (calls.length === 1) {
      return jsonResponse([]);
    }
    if (calls.length === 2) {
      return jsonResponse([{ time_sheet: { value: "sheet-1" } }]);
    }
    return jsonResponse({ sys_id: { value: "card-1" } });
  });

  const response = await bridge.syncTimeCards({ userId: "user-1", groups: [group()] });

  assert.equal(response.ok, true);
  assert.deepEqual(response.data.results, [
    {
      groupKey: "group-1",
      weekStartDate: "2026-01-05",
      status: "success",
      action: "created",
      code: "",
      message: "",
      timeCardSysId: "card-1",
    },
  ]);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /sysparm_query=.*user%3Duser-1/);
  assert.equal(calls[2].url, "/api/now/table/time_card");
  assert.equal(calls[2].options.method, "POST");
  assert.equal(calls[2].options.headers["X-UserToken"], "csrf-test-token");
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    monday: 1,
    tuesday: 2,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
    total: 3,
    comments: "Implementation",
    week_starts_on: "2026-01-05",
    user: "user-1",
    u_time_card_code: "code-1",
    rate_type: "rate-1",
    task: "task-1",
    category: "task_work",
    time_sheet: "sheet-1",
  });
});

test("[F-SYNC-05] sync updates only touched days and preserves existing hours on other days", async () => {
  const calls = [];
  const bridge = await loadPageBridge(async (url, options = {}) => {
    calls.push({ url, options: JSON.parse(JSON.stringify(options)) });
    if (calls.length === 1) {
      return jsonResponse([
        {
          sys_id: { value: "card-existing" },
          state: { display_value: "In progress" },
          monday: { value: "0.25" },
          friday: { value: "5" },
        },
      ]);
    }
    return jsonResponse({ sys_id: { value: "card-existing" } });
  });

  const response = await bridge.syncTimeCards({
    userId: "user-1",
    groups: [group({ touchedDays: ["monday"], dayHours: { monday: 1.5 }, totalHours: 1.5 })],
  });

  assert.equal(response.data.results[0].action, "updated");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "/api/now/table/time_card/card-existing");
  assert.equal(calls[1].options.method, "PATCH");
  const update = JSON.parse(calls[1].options.body);
  assert.equal(update.monday, 1.5);
  assert.equal(update.friday, 5);
  assert.equal(update.total, 6.5);
});

test("[F-SYNC-05] sync skips submitted matching time cards without sending a write request", async () => {
  const calls = [];
  const bridge = await loadPageBridge(async (url, options = {}) => {
    calls.push({ url, options: JSON.parse(JSON.stringify(options)) });
    return jsonResponse([{ sys_id: { value: "submitted-card" }, state: { value: "submitted" } }]);
  });

  const response = await bridge.syncTimeCards({ userId: "user-1", groups: [group()] });

  assert.deepEqual(response.data.results[0], {
    groupKey: "group-1",
    weekStartDate: "2026-01-05",
    status: "skipped",
    code: "SYNC_SUBMITTED_SKIP",
    action: "",
    message: "Matching time card is submitted and cannot be updated.",
    timeCardSysId: "",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
});
