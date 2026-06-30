# Feature Roadmap

This is the living tracker for LimitLens feature ideas, implementation plans, research notes, and completion status.
`PLAN.md` remains the source of truth for major architecture decisions and the decision log; this file tracks the product backlog and the path from idea to shipped feature.

## Status Key

- **Idea** - Captured but not evaluated.
- **Research** - Needs provider/API/UX verification before implementation.
- **Planned** - Direction is clear enough to implement.
- **In Progress** - Actively being built.
- **Implemented** - Shipped in the app.
- **Deferred** - Worth keeping, but not part of the near-term path.

## Current Direction

LimitLens should evolve from a tray quota viewer into a unified AI usage dashboard:

- A tiny draggable always-on-top **glance window** for high-priority limits.
- A resizable **dashboard window** for all-provider analytics, provider details, setup, history, and app settings.
- A normalized metric model that can separate exact provider-reported usage from inferred, estimated, or local-only usage.

## Near-Term Implementation Plan

### Development Workflow

**Status:** Active

LimitLens now uses a normal open-source feature flow:

- `main` is the stable integration branch.
- Build features on scoped branches with conventional prefixes: `feat/`, `fix/`, `docs/`, `chore/`, or `refactor/`.
- Do not create new `codex/` branches; older `codex/*` branches are historical only.
- Open a PR for each meaningful feature, provider integration, or architecture change.
- Treat the PR as the checkpoint: include summary, checks, screenshots for UI changes, and any decision notes.
- Merge after review/smoke testing, then start the next feature from updated `main`.
- Create GitHub Releases only from version tags such as `v0.1.1` or `v0.2.0`.

Versioning guidance:

- Patch releases (`v0.1.x`) are for fixes and small improvements.
- Minor releases (`v0.2.0`) are for larger public feature batches, such as the resizable dashboard or provider expansion.
- Feature branches are not releases; they are reviewable increments toward the next release.

### F1 - Draggable Glance Window

**Status:** Implemented

Goal: add a second, tiny always-visible window that acts as the new focus surface.

Initial display format:

```text
[provider icon] 34% | 62%
```

Meaning:

- `34%` - current/session remaining percent.
- `62%` - weekly remaining percent.

First slice:

- Windows taskbar overlay was rejected as too brittle; use a draggable always-on-top glance window instead. Implemented.
- Clicking the glance window opens the existing main popup/dashboard. Implemented.
- Store the setting locally as something like `limitlens.glanceEnabled`. Implemented.
- Reuse latest saved provider snapshots; do not create a separate refresh pipeline. Implemented.
- Show remaining percentage by default. Implemented.
- Support a draggable remembered position for the floating glance widget. Implemented.
- Show Codex, Claude, and OpenCode in a compact 2x2 layout sized for four providers. Implemented.
- Keep the display intentionally terse: provider icon, bold current/session remaining percent, divider, normal weekly remaining percent. Implemented.

Follow-up:

- Add glance provider priority settings.
- Render as many enabled providers as fit, in priority order.
- Drop lower-priority providers when space runs out instead of shrinking text into unreadability.

Possible future setting:

- Let users toggle between remaining percentage and consumed percentage.

### F2 - Dashboard-Only Main Window

**Status:** In Progress

Goal: remove the current Focus view and make the main window the full dashboard/settings surface.

Plan:

- Make the main window resizable with a sensible minimum size. Implemented in first slice.
- Remove the main-window pin control and main-window always-on-top behavior. Implemented in first slice.
- Show the main dashboard as a normal taskbar-visible app window. Implemented in first slice.
- Replace the scaled-up tray card list with an app shell: top bar, provider sidebar, and main dashboard content grid. Implemented in first slice.
- Add an All view for cross-provider usage, token, model, and price summaries. Implemented as the current overview with analytics placeholders.
- Make provider sidebar clicks replace the main content with that provider's page. Implemented.
- Move provider-specific setup out of Settings and onto provider detail pages. Implemented.
- Add starred providers, sort them first in the sidebar, and use starred providers for the glance window when present. Implemented.
- Hide explicitly disconnected providers from the sidebar and All view. Implemented.
- Add a sidebar Add Provider menu for restoring explicitly disconnected providers. Implemented.
- Keep compact behavior as a responsive small-window layout rather than a manual Focus mode.
- Keep tray icon click as the main dashboard launcher.
- Use responsive breakpoints: compact layouts can still behave like the old focus/dashboard views when the window is small, while larger sizes become a full app-style dashboard.
- Reserve the larger dashboard for analytics that need room: token spend, usage spend, reset banks, history, and provider setup.

Open decision:

- Exact breakpoint behavior and whether users should get a manual override later.
- How much of the existing compact provider rail remains after the dashboard shell matures.
- Whether Settings remains as a small app-preferences sheet or becomes a dedicated settings page once more customization exists.

### F3 - Glance Provider Priority

**Status:** Partially Implemented

Goal: let users pick which providers appear in the glance window.

Model:

```text
provider_id
enabled_on_glance: boolean
priority: number
```

Rules:

- Higher-priority providers render first.
- The glance window renders only providers with enough usable quota fields.
- Providers with no current data are skipped or shown as a compact warning only if they are high priority.

Current slice:

- Starred providers sort to the top of the dashboard sidebar.
- The glance window uses starred providers when any supported provider is starred.
- If no supported provider is starred, the glance window falls back to Codex, Claude, and OpenCode.
- DeepSeek can appear in the glance window as a single USD balance value when starred.

Follow-up:

- Replace boolean stars with explicit glance priority/order once provider count grows.
- Expand Add Provider from "restore disconnected provider" into a full provider picker for newly supported providers.

## Metric Model Evolution

### F4 - Structured Provider Metrics

**Status:** Planned

Current app state: `ProviderSnapshot` is display-first, carrying `MetricLine { label, value }`.

Needed future state: `ProviderSnapshot` should carry display lines plus structured metrics.

Candidate shape:

```text
provider_id
display_name
plan
display_lines
quota_windows
token_usage
cost_usage
reset_banks
source_quality
refreshed_at
warning
```

This should be added gradually rather than in one large rewrite.

Why this matters:

- The dashboard can aggregate usage across providers.
- The glance window can read session/weekly values without parsing strings.
- The app can label data honestly as exact, estimated, inferred, or local-only.

### F5 - Source Quality Labels

**Status:** Planned

Every non-trivial metric should eventually carry source quality:

- **Exact** - Provider reports the value directly.
- **Provider-derived** - Computed from provider-reported fields.
- **Local-only** - Derived from local logs/databases and may miss other devices.
- **Estimated** - Computed from public pricing, token logs, or incomplete data.
- **Unavailable** - Provider does not expose the value.

Rule: do not aggregate estimated and exact usage without preserving the distinction in the UI.

## Provider Roadmap

### Current Providers

| Provider | Current Status | Near-Term Work |
|---|---|---|
| Codex | Implemented for session/weekly summary | Research reset banks, extra usage, local token spend, structured metrics |
| Claude / Claude Code | Implemented for quota summary | Research local token/cost spend via logs or ccusage-style tooling |
| DeepSeek | Implemented for API balance | Keep as balance provider; token usage only if a documented usage API exists |
| OpenCode Go | Implemented via experimental console cookie | Replace pasted cookie with app-owned session or upstream read-only API if possible |
| Antigravity | Pending | Complete local language-server discovery and quota call |

### Candidate Providers

| Provider | Status | Likely Data Source | Research Needed |
|---|---|---|---|
| Cursor | Research | Cursor app local state, dashboard endpoints, usage APIs | Credential source on Windows, token refresh, live usage fields, stale spend export behavior |
| Devin | Research | CLI credentials or app local state; `GetUserStatus` style quota endpoint | Windows credential/config paths and API server behavior |
| xAI / Grok | Research | Grok CLI auth and billing endpoints; local logs for token spend | Windows CLI paths, token refresh, log format stability |
| Ollama | Idea | Local runtime/API logs, model metadata | Define what "usage" means without subscription quota; token counts may require wrapping/proxying calls |
| GitHub Copilot | Research | Local Copilot auth/session and quota APIs | Verify current provider contract and whether meaningful limits are exposed |
| OpenRouter | Research | User-supplied API key and documented credit/spend endpoints | Decide whether API-key balance providers belong beside subscription providers |
| Z.ai | Research | User-supplied API key and coding plan quotas | Validate API shape and relevance to LimitLens users |
| Xiaomi MiMo | Deferred | Dashboard/private endpoints or token-plan API | Verify stable read path before any implementation |

## Unified Token and Cost Accounting

### F6 - Token Usage Dashboard

**Status:** Research

Goal: make LimitLens a single dashboard for token usage across subscriptions, models, and provider tools.

Required concepts:

- Provider
- Account/workspace
- Model
- Input tokens
- Output tokens
- Cache read/write tokens where available
- Requests
- Cost
- Time window
- Source quality

Key constraint:

Accurate token aggregation is only possible when the provider or local tool exposes trustworthy token counts. When the app estimates from logs or pricing manifests, the dashboard must label that clearly.

### F7 - Cost and Subscription Usage

**Status:** Research

Goal: show extra usage, pay-as-you-go usage, and provider-reported cost where available.

Rules:

- Prefer provider-reported cost over calculated cost.
- Calculated cost from public pricing is useful, but must be labeled as estimated.
- Subscription "value accounting" is subjective and should be deferred until raw usage and cost are solid.

## Codex Follow-Ups

### F8 - Codex Reset Banks

**Status:** Research

Goal: show available reset banks and expiry dates.

Expected display:

```text
Rate Limit Resets: 2 available
Expires: 2026-07-12, 2026-07-19
```

Implementation notes:

- Treat reset banks as their own structured metric, not as a normal session/weekly usage row.
- Dashboard can show expiry dates.
- Glance window can show a compact `B2` later if useful.

Research needed:

- Verify the current Codex response shape for reset-bank count.
- Verify whether a separate endpoint exposes expiry dates.
- Confirm behavior for zero banks and expiring banks.

### F9 - Codex Local Token Spend

**Status:** Research

Goal: show Today, Yesterday, and Last 30 Days token/cost usage for Codex.

Research needed:

- Whether to reuse `ccusage` through an installed JS runner.
- Whether to parse logs directly in Rust.
- How Windows Codex logs differ from macOS/Linux examples.

Recommendation:

Start by researching the data shape, then decide between direct Rust parsing and invoking existing tooling.

## Upstream OpenUsage Research

Research date: 2026-06-29

Upstream project: [robinebers/openusage](https://github.com/robinebers/openusage)

Useful takeaways:

- OpenUsage currently supports Antigravity, Claude, Codex, Cursor, Devin, Grok, OpenRouter, and Z.ai.
- Its current implementation is native macOS Swift/SwiftUI, not a drop-in Tauri/Rust implementation.
- The provider architecture is still worth copying conceptually: auth store, usage client, mapper, normalized provider snapshot.
- Its metric model is ahead of ours: progress meters, raw numeric values, badges, charts, reset expiry metadata, and source-aware display choices.
- Provider docs beside implementations are valuable and should be mirrored in LimitLens as providers grow.

Provider references:

- [OpenUsage README - Supported Providers](https://github.com/robinebers/openusage#supported-providers)
- [Adding a Provider](https://github.com/robinebers/openusage/blob/main/docs/adding-a-provider.md)
- [Codex provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/codex.md)
- [Cursor provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/cursor.md)
- [Devin provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/devin.md)
- [Grok provider docs](https://github.com/robinebers/openusage/blob/main/docs/providers/grok.md)

LimitLens reuse strategy:

- Do copy provider concepts, endpoint clues, metric vocabulary, parser test discipline, and provider documentation structure.
- Do not copy macOS-specific keychain, SwiftUI, Sparkle, menu bar, or app lifecycle code.
- Reimplement provider clients in Rust and keep secrets inside the trusted host.
- Preserve the QuickJS plugin boundary unless a provider clearly belongs as trusted host-only code.

## Suggested Build Order

1. Implement F1 glance window for one provider.
2. Validate the glance UX in real daily use.
3. If useful, implement F2 dashboard-only main window and remove Focus mode.
4. Add F3 glance provider priority.
5. Add F4 structured provider metrics before deeper token/cost aggregation.
6. Research and implement Antigravity, then Cursor or Codex reset banks.
7. Add unified token/cost dashboard features only after source-quality labels exist.

## Parking Lot

- Global shortcut for dashboard open.
- Local loopback API for other tools to read usage.
- Provider-specific quick links.
- Notifications for expiring reset banks or high burn rate.
- Share/export cards.
- Full usage history after storage moves beyond latest snapshots.
