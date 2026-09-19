# Functional Overview

This is the current user-facing behavior of Time Manager. It is the reference point for planned improvements and behavior changes. Keep it in plain English and describe what users can do, not how the code is structured.

## Change policy

Before changing behavior, compare the proposed work with this overview and state whether it changes a listed capability, rule, or limitation. After the user confirms a behavior-changing implementation, update this file in the same change. Refactoring, test-only work, and documentation-only work do not need an update when user-visible behavior is unchanged.

## Local time tracking

- A user can enter any task name and start a timer from the extension popup.
- A running timer shows its task, running status, elapsed time, and an extension-toolbar badge with elapsed minutes.
- Stopping a timer saves one completed time block and leaves the task paused. Starting again resumes the same task and creates another completed block when stopped.
- Finishing a task stops it if necessary, clears the active task from the popup, and keeps its saved time blocks in history.
- The active timer is restored after the browser service worker restarts, so elapsed time continues while the timer is running.
- Local tracking works without enabling ServiceNow.

## Time blocks and dashboard

- Every saved interval is a time block with a task name, start time, end time, duration, and source (`timer` or `manual`).
- Users can add a manual block by entering a task and valid start/end time or a start time plus duration.
- Users can edit or delete any saved block. Deletion has no undo.
- The dashboard offers Today, Yesterday, This Week, This Month, All Time, and custom date ranges. The selected range preset is remembered.
- Dashboard KPIs show focused time, the number of distinct task-and-note combinations, number of blocks, and average block duration for the selected range.
- Task totals group blocks by both task name and extra notes. Period summaries group by local day or Monday-starting week.
- The time-block table is collapsible, shows the newest blocks first, and provides pagination for task totals and blocks.

## ServiceNow setup and data entry

- ServiceNow integration is optional and is configured with an HTTPS instance origin.
- Connecting requires optional permission for that origin and an open, signed-in ServiceNow tab.
- The extension can refresh and locally cache assigned tasks, time-card categories, the user's time codes, and active rate types.
- When ServiceNow is enabled, users select an assigned task or category and a time code when creating or editing a block. A rate type can be selected per block or supplied by the configured default.
- A category entry requires extra notes. A task-linked entry uses ServiceNow's `task_work` category and may have extra notes.
- The extension does not store ServiceNow credentials, cookies, or CSRF tokens; requests use the existing browser session in the connected tab.

## Extra-note suggestions

- Suggestions are available only for a selected ServiceNow category and selected time code, not for task-linked entries.
- They come from saved local blocks with the same category and time code.
- The setting "Show suggestions from last X weeks" is a rolling lookback based on each block's start time. It is not a cache expiry that is renewed by selecting a suggestion.
- Saving a new block with the same note makes that new use eligible for the configured lookback period.
- Suggestions are case-insensitively deduplicated, ordered by most recent use, and filtered by any text currently entered in Extra notes.

## ServiceNow sync

- Sync is available only for Today, This Week, This Month, or a custom bounded range; All Time cannot be synced.
- The sync preview shows how many local blocks overlap the selected range.
- Before sync, blocks are clipped to the range, split at local midnight, and grouped by workweek, assignment/category, time code, rate type, and notes.
- A missing assignment, time code, category notes, or effective rate type prevents the affected block from being synced and appears in the sync report.
- Matching editable ServiceNow time cards are updated. Matching submitted cards are skipped and never overwritten.
- The sync report shows created, updated, skipped, invalid, and failed groups.

## Current limits

- Time blocks are stored locally in the browser; there is no export, import, cloud backup, or multi-device synchronization.
- The extension has no undo for deleted blocks and no separate archive state for completed tasks.
- ServiceNow connection and writes depend on an open, signed-in tab for the configured instance.
