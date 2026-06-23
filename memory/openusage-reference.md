# openusage reference

InfUsage is inspired by / forked from openusage, but the product scope is narrower and Windows-first.

Use openusage as reference material, not as a source of truth for provider scope or platform paths.

## 2026-06-23 quick comparison

Primary reference: https://github.com/robinebers/openusage

Useful patterns:

- Tauri + React shell.
- Bundled provider plugins.
- Manifest + `plugin.js` + `probe(ctx)` provider shape.
- Normalized metric output lines: progress, text, badge; charts later.
- Provider docs beside implementations.
- Failure-tolerant states instead of crashing on provider breakage.
- Bounded concurrent probes once multiple providers exist.

Do not copy early:

- Local HTTP API.
- Proxy support.
- Analytics.
- Auto-updater.
- Autostart.
- Global shortcuts.
- Large host API surface.
- Multi-store React state before D5 is actually needed.

Important divergence:

- Rob's OpenCode Go integration reads local OpenCode SQLite spend, which misses usage from other devices, keys, and workspace members.
- InfUsage should use the user's discovered embedded-login workspace quota extraction instead.

Secondary reference: https://github.com/janekbaraniewski/openusage

Useful only as broad reference for local history, burn-rate/reporting concepts, and zero-config detection. Its Go CLI/TUI/daemon architecture is not InfUsage's path.
