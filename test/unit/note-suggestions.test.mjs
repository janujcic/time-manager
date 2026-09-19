import assert from "node:assert/strict";
import test from "node:test";
import { loadNoteSuggestions } from "../helpers/load-note-suggestions.mjs";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const nowMs = new Date(2026, 4, 1, 12, 0, 0, 0).getTime();
const category = { sysId: "category-1", value: "training" };
const code = { sysId: "code-1", value: "DEV" };

function block(overrides = {}) {
  return {
    snSelectionType: "category",
    snCategorySysId: "category-1",
    snCategoryValue: "training",
    snCodeSysId: "code-1",
    snCodeValue: "DEV",
    snCommentText: "Implementation",
    startMs: nowMs - WEEK_MS,
    ...overrides,
  };
}

for (const pageFile of ["main_window.js", "time_manager.js"]) {
  test(`[F-NOTES-01] [F-NOTES-02] ${pageFile} limits suggestions to matching category and time code`, async () => {
    const suggestions = await loadNoteSuggestions(pageFile, nowMs);
    const blocks = [
      block(),
      block({ snSelectionType: "task", snTaskSysId: "task-1", snCommentText: "Task note" }),
      block({ snCategorySysId: "other-category", snCommentText: "Other category" }),
      block({ snCodeSysId: "other-code", snCommentText: "Other code" }),
    ];
    assert.deepEqual([...suggestions(blocks, category, code, "", 4)], ["Implementation"]);
    assert.deepEqual([...suggestions(blocks, null, code, "", 4)], []);
  });

  test(`[F-NOTES-03] [F-NOTES-04] ${pageFile} uses a rolling inclusive lookback based on block start time`, async () => {
    const suggestions = await loadNoteSuggestions(pageFile, nowMs);
    const blocks = [
      block({ snCommentText: "At cutoff", startMs: nowMs - 4 * WEEK_MS }),
      block({ snCommentText: "Expired", startMs: nowMs - 4 * WEEK_MS - 1 }),
      block({ snCommentText: "New use", startMs: nowMs - 1000 }),
    ];
    assert.deepEqual([...suggestions(blocks, category, code, "", 4)], ["New use", "At cutoff"]);
  });

  test(`[F-NOTES-05] ${pageFile} deduplicates case-insensitively, orders recent notes, and filters typed text`, async () => {
    const suggestions = await loadNoteSuggestions(pageFile, nowMs);
    const blocks = [
      block({ snCommentText: "Planning", startMs: nowMs - 2000 }),
      block({ snCommentText: "planning", startMs: nowMs - 1000 }),
      block({ snCommentText: "Review", startMs: nowMs - 500 }),
    ];
    assert.deepEqual([...suggestions(blocks, category, code, "", 4)], ["Review", "planning"]);
    assert.deepEqual([...suggestions(blocks, category, code, "pla", 4)], ["planning"]);
  });
}
