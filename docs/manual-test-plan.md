# Manual Test Plan

Run `npm test` after production-code or manifest changes. It checks syntax and the manifest, validates Firefox compatibility, tests timer and sync-data logic, and runs the Chromium user-flow tests. These automated tests never connect to ServiceNow.

## Load and basic timer

1. Load the repository root as an unpacked extension and open the popup.
2. Enter a task, start it, confirm the popup and extension badge show a running timer.
3. Stop it, confirm a timer-sourced block appears in the dashboard, then resume and stop again.
4. Finish the task and confirm the popup returns to task registration.
5. Reload the extension while a timer is running; reopen the popup and confirm elapsed time continues.

## Dashboard and stored blocks

1. Add a manual time block with valid start, duration, and end values.
2. Edit the block, then delete it; confirm dashboard totals and block count update each time.
3. Change range and day/week grouping controls; confirm only matching blocks contribute to totals.
4. Close and reopen the dashboard; confirm stored blocks and the selected range preset remain available.

## Firefox smoke test

1. Run `npm run lint:extension` and review any warnings. The current baseline has warnings related to existing Firefox compatibility declarations and dynamic table rendering; it has no lint errors.
2. Run `npm run firefox` to launch the extension temporarily in Firefox. It reloads source changes while running.
3. Repeat the Load and basic timer checks above.
4. Repeat the Dashboard and stored blocks checks above.

No ServiceNow connection or sync write is part of this smoke test. Sync grouping and outgoing payloads are covered by local fixture tests.
