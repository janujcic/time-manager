import assert from "node:assert/strict";
import test from "node:test";
import { loadBackground } from "../helpers/load-background.mjs";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function localTime(year, monthIndex, day, hour, minute) {
  return new Date(year, monthIndex, day, hour, minute, 0, 0).getTime();
}

function taskBlock(overrides = {}) {
  return {
    id: "block-1",
    task: "Project work",
    startMs: localTime(2026, 0, 5, 9, 0),
    endMs: localTime(2026, 0, 5, 10, 0),
    snSelectionType: "task",
    snTaskSysId: "task-1",
    snTaskNumber: "TASK001",
    snTaskShortDescription: "Project work",
    snCategoryValue: "task_work",
    snCodeSysId: "code-1",
    snCodeValue: "DEV",
    snCodeDescription: "Development",
    snRateTypeSysId: "rate-1",
    snCommentText: "Implementation",
    ...overrides,
  };
}

test("stopping a timer stores one completed block and finish clears the runtime", async () => {
  const startMs = localTime(2026, 0, 5, 9, 0);
  const { api, setNow, storage } = await loadBackground({ nowMs: startMs });

  assert.equal((await api.startTimer("Write tests")).status, "started");
  setNow(startMs + 90 * MINUTE_MS);
  assert.equal((await api.stopTimer()).status, "stopped");

  assert.deepEqual(await api.getBlocks(), [
    {
      id: "test-block-id",
      task: "Write tests",
      startMs,
      endMs: startMs + 90 * MINUTE_MS,
      durationMs: 90 * MINUTE_MS,
      source: "timer",
      createdAtMs: startMs + 90 * MINUTE_MS,
      snSelectionType: "",
      snTaskSysId: "",
      snTaskNumber: "",
      snTaskShortDescription: "",
      snCategorySysId: "",
      snCategoryValue: "",
      snCategoryLabel: "",
      snCodeSysId: "",
      snCodeValue: "",
      snCodeDescription: "",
      snCommentText: "",
      snRateTypeSysId: "",
    },
  ]);
  assert.equal(api.getTimerData().isRunning, false);
  assert.equal(api.getTimerData().elapsedTime, 90 * MINUTE_MS);

  await api.finishTimer();
  assert.equal(storage.snapshot().timer_runtime, null);
  assert.equal(api.getTimerData().savedTaskName, "");
});

test("a running timer restores its task and elapsed time after a service-worker restart", async () => {
  const nowMs = localTime(2026, 0, 5, 10, 0);
  const { api } = await loadBackground({
    nowMs,
    initialStorage: {
      timer_runtime: {
        savedTaskName: "Restored task",
        isRunning: true,
        elapsedBeforeActiveMs: 30 * MINUTE_MS,
        activeBlockStartMs: nowMs - 15 * MINUTE_MS,
        snSelectionType: "",
      },
    },
  });

  assert.equal(api.getTimerData().savedTaskName, "Restored task");
  assert.equal(api.getTimerData().isRunning, true);
  assert.equal(api.getTimerData().elapsedTime, 45 * MINUTE_MS);
});

test("sync aggregation splits midnight blocks, groups matching metadata, and applies default rate type", async () => {
  const { api } = await loadBackground();
  const overnight = taskBlock({
    id: "overnight",
    startMs: localTime(2026, 0, 5, 23, 30),
    endMs: localTime(2026, 0, 6, 1, 30),
    snRateTypeSysId: "",
  });
  const wednesday = taskBlock({
    id: "wednesday",
    startMs: localTime(2026, 0, 7, 9, 0),
    endMs: localTime(2026, 0, 7, 10, 0),
    snRateTypeSysId: "",
  });

  const result = api.aggregateBlocksForSync([overnight, wednesday], [], null, "default-rate");

  assert.equal(result.invalidBlocks.length, 0);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].dayHours, {
    monday: 0.5,
    tuesday: 1.5,
    wednesday: 1,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  });
  assert.equal(result.groups[0].totalHours, 3);
  assert.equal(result.groups[0].snRateTypeSysId, "default-rate");
  assert.deepEqual(result.groups[0].touchedDays, ["monday", "tuesday", "wednesday"]);
  assert.deepEqual(result.groups[0].blockIds, ["overnight", "wednesday"]);
});

test("sync aggregation separates unrelated data and reports invalid blocks", async () => {
  const { api } = await loadBackground();
  const validTask = taskBlock();
  const differentNotes = taskBlock({ id: "different-notes", snCommentText: "Review" });
  const missingCategoryNotes = taskBlock({
    id: "missing-notes",
    snSelectionType: "category",
    snTaskSysId: "",
    snCategoryValue: "training",
    snCommentText: "",
  });
  const missingCode = taskBlock({ id: "missing-code", snCodeSysId: "" });

  const result = api.aggregateBlocksForSync(
    [validTask, differentNotes, missingCategoryNotes, missingCode],
    [],
    null,
    ""
  );

  assert.equal(result.groups.length, 2);
  assert.deepEqual(result.invalidBlocks, [
    { blockId: "missing-notes", reason: "missing category notes" },
    { blockId: "missing-code", reason: "missing assignment or time code" },
  ]);
});

test("sync aggregation clips a selected block to the requested date range", async () => {
  const { api } = await loadBackground();
  const block = taskBlock({
    startMs: localTime(2026, 0, 5, 8, 0),
    endMs: localTime(2026, 0, 5, 12, 0),
  });
  const startMs = localTime(2026, 0, 5, 9, 0);
  const endMs = localTime(2026, 0, 5, 10, 0) - 1;

  const result = api.aggregateBlocksForSync([block], ["block-1"], { startMs, endMs }, "");

  assert.equal(result.requestedBlockCount, 1);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].totalHours, 1);
  assert.deepEqual(result.groups[0].dayHours, {
    monday: 1,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
  });
});
