import assert from "node:assert/strict";
import test from "node:test";
import { loadBackground } from "../helpers/load-background.mjs";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function localTime(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).getTime();
}

function taskMetadata(overrides = {}) {
  return {
    snSelectionType: "task",
    snTaskSysId: "task-1",
    snTaskNumber: "TASK001",
    snTaskShortDescription: "Project work",
    snCodeSysId: "code-1",
    snCodeValue: "DEV",
    snCodeDescription: "Development",
    snRateTypeSysId: "rate-1",
    snCommentText: "Implementation",
    ...overrides,
  };
}

async function enableServiceNow(api) {
  const response = await api.saveConfig({
    enabled: true,
    instanceUrl: "https://example.service-now.com",
    defaultRateTypeSysId: "default-rate",
    notesSuggestionWeeks: 4,
  });
  assert.equal(response.status, "success");
}

function connectedBridge(responder = () => ({ status: "success" })) {
  return (tabId, message) => {
    if (message.action === "sn_bridge_ping") return { status: "success" };
    return responder(tabId, message);
  };
}

test("[F-TIMER-02] [F-TIMER-03] [F-TIMER-06] timer indicators reflect running and paused state, resume creates a second block, and disabled ServiceNow does not block tracking", async () => {
  const startMs = localTime(2026, 0, 5, 9, 0);
  const { api, setNow, actionCalls } = await loadBackground({ nowMs: startMs });

  assert.equal((await api.startTimer("Local work")).status, "started");
  assert.deepEqual(actionCalls.at(-2), {
    method: "setBadgeText",
    details: { text: "0m" },
  });

  setNow(startMs + 30 * MINUTE_MS);
  await api.stopTimer();
  assert.deepEqual(actionCalls.at(-2), {
    method: "setBadgeText",
    details: { text: "PAUSE" },
  });

  setNow(startMs + 45 * MINUTE_MS);
  await api.startTimer("Local work");
  setNow(startMs + 60 * MINUTE_MS);
  await api.stopTimer();
  const blocks = await api.getBlocks();
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((block) => block.durationMs), [30 * MINUTE_MS, 15 * MINUTE_MS]);
  assert.deepEqual(blocks.map((block) => block.snSelectionType), ["", ""]);
});

test("[F-DASH-01] [F-DASH-02] [F-DASH-03] saved manual blocks support both end-time and duration input, update, and permanent deletion", async () => {
  const startMs = localTime(2026, 0, 5, 9, 0);
  const { api } = await loadBackground({ nowMs: startMs });

  await api.saveManualSession({ taskName: "End time", startTimeMs: startMs, endTimeMs: startMs + HOUR_MS });
  await api.saveManualSession({ taskName: "Duration", startTimeMs: startMs, taskDuration: 90 * MINUTE_MS });
  let blocks = await api.getBlocks();
  assert.deepEqual(
    blocks.map(({ task, startMs: blockStart, endMs, durationMs, source }) => ({ task, blockStart, endMs, durationMs, source })),
    [
      { task: "End time", blockStart: startMs, endMs: startMs + HOUR_MS, durationMs: HOUR_MS, source: "manual" },
      { task: "Duration", blockStart: startMs, endMs: startMs + 90 * MINUTE_MS, durationMs: 90 * MINUTE_MS, source: "manual" },
    ]
  );

  const firstId = blocks[0].id;
  assert.equal(
    (await api.updateTimeBlock(firstId, { taskName: "Edited", startTimeMs: startMs, endTimeMs: startMs + 2 * HOUR_MS })).status,
    "success"
  );
  assert.equal((await api.deleteTimeBlock(firstId)).status, "success");
  assert.equal((await api.deleteTimeBlock(firstId)).status, "error");
  blocks = await api.getBlocks();
  assert.deepEqual(blocks.map((block) => block.task), ["Duration"]);
});

test("[F-SN-01] [F-SN-05] ServiceNow accepts only an HTTPS origin and enforces task/category metadata rules", async () => {
  const { api } = await loadBackground();
  assert.equal((await api.saveConfig({ enabled: true, instanceUrl: "http://example.service-now.com" })).code, "SN_NO_CONFIG");
  assert.equal((await api.saveConfig({ enabled: true, instanceUrl: "https://example.service-now.com/path" })).code, "SN_NO_CONFIG");
  await enableServiceNow(api);

  const startMs = localTime(2026, 0, 5, 9, 0);
  const invalidCategory = await api.saveManualSession({
    taskName: "Training",
    startTimeMs: startMs,
    endTimeMs: startMs + HOUR_MS,
    snSelectionType: "category",
    snCategorySysId: "category-1",
    snCategoryValue: "training",
    snCodeSysId: "code-1",
  });
  assert.match(invalidCategory.message, /Extra notes are required/);
  const reservedTaskWork = await api.saveManualSession({
    taskName: "Bad category",
    startTimeMs: startMs,
    endTimeMs: startMs + HOUR_MS,
    snSelectionType: "category",
    snCategorySysId: "category-1",
    snCategoryValue: "task_work",
    snCodeSysId: "code-1",
    snCommentText: "Notes",
  });
  assert.match(reservedTaskWork.message, /reserved/);
});

test("[F-SN-02] [F-LIMIT-03] connection requires host permission and an open instance tab", async () => {
  const denied = await loadBackground({ grantPermission: false });
  await enableServiceNow(denied.api);
  assert.equal((await denied.api.connectServiceNowSession()).code, "SN_PERMISSION_DENIED");
  assert.deepEqual(denied.permissionCalls.at(-1).details, { origins: ["https://example.service-now.com/*"] });

  const noTab = await loadBackground({ hasPermission: true });
  await enableServiceNow(noTab.api);
  assert.equal((await noTab.api.connectServiceNowSession()).code, "SN_NO_TAB");
});

test("[F-SN-03] [F-SN-04] lookup refresh caches normalized values and task entries preserve the chosen code and rate", async () => {
  const { api, storage } = await loadBackground({
    hasPermission: true,
    tabs: [{ id: 7, active: true }],
    onTabMessage: connectedBridge((_tabId, message) => {
      if (message.envelope.action === "checkSession") {
        return { status: "success", data: { userId: "user-1" } };
      }
      return {
        status: "success",
        data: {
          tasks: [{ sys_id: { value: "task-1" }, number: { value: "TASK001" }, short_description: { value: "Work" } }],
          categories: [{ sys_id: { value: "category-1" }, value: { value: "training" }, label: { value: "Training" }, language: { value: "en" }, sequence: { value: "2" } }],
          timeCodes: [{ sys_id: { value: "code-1" }, u_time_card_code: { value: "DEV" }, u_description: { value: "Development" } }],
          rateTypes: [{ sys_id: { value: "rate-1" }, name: { value: "Standard" } }],
        },
      };
    }),
  });
  await enableServiceNow(api);
  const cacheResponse = await api.fetchLookups();
  assert.equal(cacheResponse.status, "success");
  assert.equal(cacheResponse.data.timeCodes[0].label, "DEV | Development");
  assert.equal(storage.snapshot().sn_lookup_cache.rateTypes[0].name, "Standard");

  const startMs = localTime(2026, 0, 5, 9, 0);
  await api.saveManualSession({ taskName: "Work", startTimeMs: startMs, endTimeMs: startMs + HOUR_MS, ...taskMetadata() });
  const [block] = await api.getBlocks();
  assert.deepEqual(
    { type: block.snSelectionType, task: block.snTaskSysId, code: block.snCodeSysId, rate: block.snRateTypeSysId },
    { type: "task", task: "task-1", code: "code-1", rate: "rate-1" }
  );
});

test("[F-SYNC-01] bounded sync rejects All Time and invalid bounds before any connection attempt", async () => {
  const { api, tabMessages } = await loadBackground();
  assert.match((await api.syncVisibleBlocks({ rangePreset: "all", blockIds: ["block-1"] })).message, /bounded range/);
  assert.match((await api.syncVisibleBlocks({ rangePreset: "today", blockIds: ["block-1"], startMs: 2, endMs: 1 })).message, /Invalid sync bounds/);
  assert.equal(tabMessages.length, 0);
});

test("[F-SYNC-03] sync aggregation separates workweek, assignment, code, rate, and notes while retaining matching blocks in one group", async () => {
  const { api } = await loadBackground();
  const startMs = localTime(2026, 0, 5, 9, 0);
  const base = {
    id: "base",
    task: "Work",
    startMs,
    endMs: startMs + HOUR_MS,
    ...taskMetadata(),
  };
  const blocks = [
    base,
    { ...base, id: "same", startMs: startMs + HOUR_MS, endMs: startMs + 2 * HOUR_MS },
    { ...base, id: "other-task", snTaskSysId: "task-2" },
    { ...base, id: "other-code", snCodeSysId: "code-2" },
    { ...base, id: "other-rate", snRateTypeSysId: "rate-2" },
    { ...base, id: "other-note", snCommentText: "Review" },
    { ...base, id: "other-week", startMs: startMs + 7 * 24 * HOUR_MS, endMs: startMs + 7 * 24 * HOUR_MS + HOUR_MS },
  ];
  const result = api.aggregateBlocksForSync(blocks);
  assert.equal(result.invalidBlocks.length, 0);
  assert.equal(result.groups.length, 6);
  const matchingGroup = result.groups.find((group) => group.blockIds.includes("base"));
  assert.deepEqual(matchingGroup.blockIds, ["base", "same"]);
  assert.equal(matchingGroup.totalHours, 2);
});

test("[F-SYNC-04] [F-SYNC-06] sync reports invalid blocks and every returned result outcome locally", async () => {
  const startMs = localTime(2026, 0, 5, 9, 0);
  const { api } = await loadBackground({
    hasPermission: true,
    tabs: [{ id: 7, active: true }],
    initialStorage: {
      timeBlocks: [
        {
          id: "invalid",
          task: "Invalid",
          startMs,
          endMs: startMs + HOUR_MS,
          durationMs: HOUR_MS,
          source: "manual",
          ...taskMetadata({ snCodeSysId: "" }),
        },
      ],
    },
    onTabMessage: connectedBridge((_tabId, message) => {
      if (message.envelope.action === "checkSession") return { status: "success", data: { userId: "user-1" } };
      return {
        status: "success",
        data: {
          results: [
            { groupKey: "a", action: "created", status: "success" },
            { groupKey: "b", action: "updated", status: "success" },
            { groupKey: "c", code: "SYNC_SUBMITTED_SKIP", status: "skipped" },
            { groupKey: "d", code: "SYNC_FAILED", status: "error" },
          ],
        },
      };
    }),
  });
  await enableServiceNow(api);
  for (const note of ["a", "b", "c", "d"]) {
    await api.saveManualSession({ taskName: note, startTimeMs: startMs, endTimeMs: startMs + HOUR_MS, ...taskMetadata({ snCommentText: note }) });
  }
  const blocks = await api.getBlocks();
  const report = await api.syncVisibleBlocks({ rangePreset: "today", blockIds: blocks.map((block) => block.id), startMs: startMs, endMs: startMs + HOUR_MS - 1 });
  assert.equal(report.status, "success");
  assert.deepEqual(
    { created: report.data.created, updated: report.data.updated, skipped: report.data.skippedSubmitted, invalid: report.data.skippedInvalid, failed: report.data.failed },
    { created: 1, updated: 1, skipped: 1, invalid: 1, failed: 1 }
  );
});
