# Time Manager Agent Guide

## Purpose and structure

This is a dependency-free Manifest V3 browser extension for tracking focused work and, when enabled, syncing time cards to ServiceNow.

- `background.js` owns persisted state, timer lifecycle, extension action state, and ServiceNow orchestration.
- `main_window.*` is the extension-action popup for starting, stopping, resuming, and finishing a timer.
- `time_manager.*` is the dashboard for reporting and manual time-block management.
- `sn_content_bridge.js` transfers messages between extension and page contexts.
- `sn_page_bridge.js` is the only code that calls ServiceNow APIs; it uses the user's existing authenticated browser session.
- `shared_styles.css` contains the shared UI styles.

Read `docs/architecture.md` before changing data flow or module responsibilities. Read `docs/servicenow-integration.md` before changing ServiceNow behavior.

## Engineering rules

- Write clear, user-understandable code. Prefer descriptive names, small focused functions, and plain control flow over clever abstractions.
- Preserve existing browser compatibility and keep the extension dependency-free unless the task clearly requires a dependency.
- Keep UI code in its window script. Keep shared state, storage access, and ServiceNow orchestration in `background.js`.
- Never store ServiceNow credentials, cookies, or CSRF tokens. Do not bypass the content/page bridge for ServiceNow requests.
- Treat stored data as durable user data. Maintain backward compatibility for storage keys and block fields, and add migrations when a stored shape changes.
- Preserve timer blocks and elapsed time across service-worker restarts.
- ServiceNow sync must remain bounded to a requested date range, preserve its grouping rules, and never overwrite submitted time cards.

## Change and verification workflow

- Clarify behavior or product choices with the user when they are ambiguous or would alter data, sync behavior, or the UI workflow.
- Use red-green-refactor development for behavior changes: write a focused failing test first when the logic can be isolated, make it pass with the smallest change, then improve the code.
- For logic that needs tests, prefer extracting a small pure module and testing it with Node's built-in test runner. Do not add an empty test directory or a test framework without a real first test.
- Run `npm run check` after JavaScript, HTML, manifest, or documentation changes.
- Run the relevant cases in `docs/manual-test-plan.md` for user-facing or ServiceNow changes. Say clearly when browser or ServiceNow checks could not be performed.
- Update the relevant documentation when changing architecture, persisted data, supported messages, ServiceNow behavior, or manual verification steps.

## Done means

A change is complete when it is scoped to the request, understandable to a future maintainer, checked with `npm run check`, manually verified where applicable, and documented when it changes a documented contract.
