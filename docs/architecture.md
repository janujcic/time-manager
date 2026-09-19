# Architecture

Time Manager is a plain JavaScript Manifest V3 browser extension. It has no build step or runtime dependencies.

## Components

```text
Extension popup ─┐
                 ├─ runtime messages ─> background service worker ─> chrome.storage.local
Dashboard ───────┘                                  │
                                                     └─ ServiceNow tab bridge ─> ServiceNow REST API
```

- The popup (`main_window.html` and `main_window.js`) starts, pauses, resumes, and finishes a timer.
- The dashboard (`time_manager.html` and `time_manager.js`) shows reports and lets the user add, edit, delete, filter, and sync time blocks.
- The background service worker (`background.js`) is the source of truth for timer state, stored blocks, validation, extension badge updates, and ServiceNow orchestration.
- The content bridge (`sn_content_bridge.js`) receives extension messages in a ServiceNow tab and forwards them to page code.
- The page bridge (`sn_page_bridge.js`) performs same-origin ServiceNow requests with the session already present in that tab. It must not contain or persist credentials.

## Stored data

All data is in `chrome.storage.local`.

| Key | Purpose |
| --- | --- |
| `timeBlocks` | Completed timer and manual blocks. Each has an ID, task, start/end timestamps, duration, source, and optional ServiceNow metadata. |
| `timer_runtime` | Current timer task, running state, accumulated duration, active start time, and ServiceNow metadata; restores an active timer after service-worker restart. |
| `sn_config` | Whether integration is enabled, the ServiceNow instance origin, default rate type, and note-suggestion lookback period. |
| `sn_lookup_cache` | Cached assigned tasks, categories, time codes, and rate types fetched from ServiceNow. |
| `dashboardPreferences` | The last selected dashboard range preset. |

Old storage keys are removed by `initializeStorage()` in `background.js`. Update that migration path if a persistent shape changes.

## Runtime message contract

The UI sends messages to `background.js`; the service worker sends `updateTime` to refresh the popup.

| Area | Requests |
| --- | --- |
| Timer | `start`, `stop`, `finish`, `checkStatus` |
| Time blocks | `getTimeBlocks`, `saveManualSession`, `updateTimeBlock`, `deleteTimeBlock` |
| Reports | `getSessions`, `getAggregatedSessions`, `getAggregatedByPeriod` |
| ServiceNow | `servicenow/getConfig`, `servicenow/saveConfig`, `servicenow/connect`, `servicenow/checkSession`, `servicenow/fetchLookups`, `servicenow/getCachedLookups`, `servicenow/syncVisibleBlocks` |

Keep request and response shapes compatible when changing an existing action. Add new actions rather than silently changing the meaning of an existing one.

## Important invariants

- A time block has a positive duration: `endMs` is later than `startMs`.
- Stopping a timer appends one completed block; finishing a timer clears the active runtime after stopping it.
- ServiceNow metadata is required only when the integration is enabled. A category requires notes; a task or category requires a time code.
- A sync range is bounded. Blocks are clipped to it, split at local midnight, and grouped by workweek, assignment/category, time code, rate type, and notes.

For external-system details, see [ServiceNow integration](servicenow-integration.md). For hands-on checks, see [the manual test plan](manual-test-plan.md).
