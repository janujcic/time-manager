# time-manager

A simple extension meant for tracking the time spent on different tasks. The goal is easily measure time spent on a single task. This should encourage deep work and prevent task switching.

The task switching should be frictionless and seamless to do. This will allow for an overview on what the time is spent on. The overview then allows you to reflect on what tasks are really valuable and how to start prioritizing them more.

## Development

This is a plain JavaScript Manifest V3 extension with no build step or runtime dependencies. Load the repository root as an unpacked extension in a Chromium-based browser, then reload the extension after source changes.

Run the available automated checks with:

```sh
npm run check
```

Useful project documentation:

- [Architecture](docs/architecture.md)
- [ServiceNow integration](docs/servicenow-integration.md)
- [Manual test plan](docs/manual-test-plan.md)
- [Agent guide](AGENTS.md)
