# Manual Test Plan

Run `npm test` after production-code or manifest changes. It checks syntax and the manifest, validates Firefox compatibility, tests timer and sync-data logic, and runs the Chromium user-flow tests. These automated tests never connect to ServiceNow.

## Load and basic timer

1. Load the repository root as an unpacked extension and open the popup.
2. Confirm the initial Task Registration view fits without page scrollbars, including when ServiceNow entry fields are shown.
3. [F-TIMER-02] Enter a task, start it, confirm the popup and extension badge show a running timer.
4. Stop it, confirm a timer-sourced block appears in the dashboard, then resume and stop again.
5. Finish the task and confirm the popup returns to task registration.
6. Reload the extension while a timer is running; reopen the popup and confirm elapsed time continues.
7. With ServiceNow disabled, finish a named task and confirm its name appears as a filtered suggestion when starting the next task.

## Dashboard and stored blocks

1. Add a manual time block with valid start, duration, and end values.
2. Edit the block, then delete it; confirm dashboard totals and block count update each time.
3. Change range and day/week grouping controls; confirm only matching blocks contribute to totals.
4. Close and reopen the dashboard; confirm stored blocks and the selected range preset remain available.
5. Confirm the dashboard opens without page scrolling before Time Blocks is expanded; scrolling after expanding a long block history is expected.

## Profiles

1. Confirm the Dashboard and Task Registration window both show the active Default profile.
2. Create a profile in the Dashboard. Confirm both open views immediately show it and that its dashboard starts with no blocks or ServiceNow configuration.
3. Add a block in each profile, switch between them, and confirm each view shows only that profile's data and remembered range.
4. With ServiceNow disabled, confirm task-name suggestions change with the active profile and reappear after switching back.
5. Start or pause a task, then confirm profile switching and deletion are unavailable. Finish it and confirm switching works again.
6. Rename Default, create another profile, then delete that non-Default profile. Confirm the deletion warning, activation of Default, and permanent removal of the deleted profile's data.

## Firefox smoke test

1. Run `npm run lint:extension` and review any warnings. The current baseline has warnings related to existing Firefox compatibility declarations and dynamic table rendering; it has no lint errors.
2. Run `npm run firefox` to launch the extension temporarily in Firefox. It reloads source changes while running.
3. Repeat the Load and basic timer checks above.
4. Repeat the Dashboard and stored blocks checks above.

No ServiceNow connection or sync write is part of this smoke test. Sync grouping and outgoing payloads are covered by local fixture tests.
