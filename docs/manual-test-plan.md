# Manual Test Plan

Run the relevant checks after a user-facing change. Use a non-production ServiceNow instance for integration checks.

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

## ServiceNow, when changed

1. With integration disabled, confirm ordinary local tracking still works.
2. Enable it with an invalid URL and confirm saving explains the requirement for an HTTPS origin.
3. With a signed-in ServiceNow tab open, connect and refresh lookup data.
4. Create one valid task-linked entry and one category entry with notes and a time code.
5. Sync a bounded range and verify the report. Check that submitted matching cards are skipped, not modified.

Do not test sync writes against production data unless the user has explicitly approved that scope.
