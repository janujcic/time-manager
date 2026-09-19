# time-manager

A simple extension meant for tracking the time spent on different tasks. The goal is easily measure time spent on a single task. This should encourage deep work and prevent task switching.

The task switching should be frictionless and seamless to do. This will allow for an overview on what the time is spent on. The overview then allows you to reflect on what tasks are really valuable and how to start prioritizing them more.

## Development

This is a plain JavaScript Manifest V3 extension with no build step or runtime dependencies. Load the repository root as an unpacked extension in a Chromium-based browser, then reload the extension after source changes.

Install the local development dependencies and Chromium test browser once:

```sh
npm install
npm run install:chromium
```

Run the full local validation suite after production-code or manifest changes:

```sh
npm test
```

For focused work, use `npm run test:unit`, `npm run test:chromium`, or `npm run test:headed`. Run `npm run firefox` for the manual Firefox smoke test.

Useful project documentation:

- [Functional overview](docs/functional-overview.md)
- [Functional test matrix](docs/functional-test-matrix.md)
- [Architecture](docs/architecture.md)
- [ServiceNow integration](docs/servicenow-integration.md)
- [Manual test plan](docs/manual-test-plan.md)
- [Agent guide](AGENTS.md)
