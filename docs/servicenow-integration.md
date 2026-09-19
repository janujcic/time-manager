# ServiceNow Integration

ServiceNow integration is optional. It uses the user's existing authenticated ServiceNow browser tab; the extension does not collect or store credentials, cookies, or CSRF tokens.

## Connection flow

1. The user enables the integration and saves an HTTPS instance origin, such as `https://example.service-now.com`.
2. The extension requests optional host permission for that origin.
3. The background worker finds an open tab for the configured instance and checks its session through the bridges.
4. The page bridge reads the session user and CSRF token from the page or a ServiceNow fallback endpoint, then makes same-origin API requests.

If the session is missing, the user must open the configured instance, sign in, and connect again.

## Lookup data

Refreshing ServiceNow data fetches:

- assigned, open tasks;
- active English `time_card` categories;
- the current user's time codes; and
- active rate types.

The result is cached locally for the popup and dashboard. Cache data is a convenience, not proof that the ServiceNow session is still valid.

## Time-block requirements

When integration is enabled, a new or edited block must have:

- an assignment selected from the cached task/category suggestions;
- a time code; and
- notes for a category entry.

Task-linked entries use the `task_work` category. A rate type is optional on an individual block but required by sync; sync uses the configured default rate type when a block does not have one.

## Sync behavior

Only today, this week, this month, or a custom bounded range can be synced. The worker:

1. Clips selected blocks to the requested range.
2. Splits blocks that cross local midnight.
3. Groups daily hours into ServiceNow workweeks by assignment/category, time code, rate type, and notes.
4. Creates a new matching `time_card` or updates an existing editable one.

Matching submitted time cards are skipped and never overwritten. Blocks with missing metadata are reported as invalid rather than silently synced with incomplete data.

## Safe changes

Before changing lookup queries, metadata fields, grouping, or time-card writes, verify the result against a non-production ServiceNow instance. Preserve the bridge boundary: extension code orchestrates, while `sn_page_bridge.js` makes the authenticated ServiceNow requests.
