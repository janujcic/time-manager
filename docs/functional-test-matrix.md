# Functional Test Matrix

This file connects every user-facing rule in the [functional overview](functional-overview.md) to a test decision. It is deliberately a map, not a duplicate test plan.

## How to use it

- Give each new or changed functional rule a stable `F-...` ID in the functional overview.
- Choose `Automated` when a local test can prove the observable rule. Put the same ID in that test's title, for example `[F-TIMER-01]`.
- Choose `Manual` only for a browser interaction that needs a person to inspect it. Name the relevant case in the manual test plan.
- Choose `Planned` for a known gap. It is visible in every `npm test` run, but it does not make the suite fail during this first-draft rollout.
- Before calling a feature fully covered, replace `Planned` with `Automated` or `Manual`. Do not use a broad end-to-end flow as evidence for details it does not assert.

`npm run test:coverage` validates that every overview ID has exactly one row and that every `Automated` row has a matching test tag. `npm test` runs that validation before the existing checks and tests.

## Current map

| Feature | Status | Evidence or next test |
| --- | --- | --- |
| F-TIMER-01 | Automated | Chromium popup flow: start a named task |
| F-TIMER-02 | Manual | Manual test plan, Load and basic timer, step 2; add a background badge assertion later |
| F-TIMER-03 | Automated | Background timer indicator and resume test |
| F-TIMER-04 | Automated | Background timer test and Chromium popup flow |
| F-TIMER-05 | Automated | Background service-worker restoration test |
| F-TIMER-06 | Automated | Background timer test with default disabled ServiceNow configuration |
| F-DASH-01 | Automated | Background manual-block shape test |
| F-DASH-02 | Automated | Background manual-block tests for explicit end time and duration |
| F-DASH-03 | Automated | Background update/delete test; deletion cannot be repeated |
| F-DASH-04 | Automated | Chromium dashboard range-persistence flow |
| F-DASH-05 | Automated | Chromium KPI assertions with distinct task-and-note combinations |
| F-DASH-06 | Automated | Chromium task-plus-note and weekly-period assertions |
| F-DASH-07 | Automated | Chromium collapse, pagination, and newest-first flow |
| F-SN-01 | Automated | Background HTTPS-origin validation test |
| F-SN-02 | Automated | Background permission and open-tab mock tests |
| F-SN-03 | Automated | Background lookup refresh/cache fixture test |
| F-SN-04 | Automated | Background selected task, code, and rate persistence test |
| F-SN-05 | Automated | Background category and task metadata validation tests |
| F-SN-06 | Automated | Static request-boundary and configuration-shape test |
| F-NOTES-01 | Automated | Unit tests against both popup and dashboard suggestion implementations |
| F-NOTES-02 | Automated | Unit tests against both popup and dashboard suggestion implementations |
| F-NOTES-03 | Automated | Unit tests at the rolling lookback boundary |
| F-NOTES-04 | Automated | Unit tests for a newly saved matching use |
| F-NOTES-05 | Automated | Unit tests for deduplication, recency ordering, and typed filtering |
| F-SYNC-01 | Automated | Background bounded-range rejection test |
| F-SYNC-02 | Automated | Chromium local sync-preview flow |
| F-SYNC-03 | Automated | Background tests for clipping, midnight splits, and every grouping key |
| F-SYNC-04 | Automated | Background invalid-block and sync-report test |
| F-SYNC-05 | Automated | Page-bridge fixture tests for create, update, and submitted-card skip |
| F-SYNC-06 | Automated | Background report test for created, updated, submitted, invalid, and failed outcomes |
| F-LIMIT-01 | Automated | Static product-surface check for local-only storage and no transfer feature path |
| F-LIMIT-02 | Automated | Static product-surface check for no undo or archive feature path |
| F-LIMIT-03 | Automated | Background open-tab requirement test |
