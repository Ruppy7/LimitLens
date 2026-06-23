# InfUsage — Inference Usage Tracker for Windows

InfUsage is a Windows-native system-tray app that tracks AI inference usage and spend in one place. It is a real utility and a pairing/learning project.

## Product scope

- **Core:** OpenAI Codex; Anthropic Claude / Claude Code as one shared-limits integration; OpenCode Go; Antigravity (AGY).
- **Backlog optional:** Xiaomi MiMo Token Plan Lite.
- **Optional:** DeepSeek API balance tracking.

Inspired by / forked from [openusage](https://github.com/robinebers/openusage).

## How we'll work

```text
Decision → Concept → Build → Checkpoint
```

- We decide before coding.
- Each real choice gets 2–3 alternatives and a recommendation.
- Rust code should be annotated for read-fluency early on.
- The decision log below is the lightweight ADR record.

## Decision log

| # | Decision | Contenders | Status | Rationale |
|---|---|---|---|---|
| D1 | Desktop shell | Tauri v2 · Electron · WinUI/WPF · Flutter | ✅ **Decided: Tauri v2** | Best fit for an always-on tray utility: small WebView shell, Rust-native host, tray APIs, and a capability/security model that fits the host/UI/plugin boundary. |
| D2 | Frontend | React+TS · Svelte · SolidJS · plain TS | ✅ **Decided: React + TypeScript + Vite** | Matches the official Tauri scaffold, keeps the UI in familiar React, and gives safer IPC/data-shape contracts with TypeScript. Tailwind remains a later styling add-on. |
| D3 | Backend language | Rust · Go sidecar · Node sidecar | ✅ **Decided: Rust inside Tauri** | Use Tauri's native Rust host only. No Node/Go sidecar and no Rust web framework. Add crates only when forced by a feature: `serde` for real IPC payloads, `reqwest` for provider HTTP, SQLite crate at D6, and `thiserror` only if string errors become messy. |
| D4 | Plugin runtime | QuickJS sandbox · WASM · native Rust modules · subprocess | Leaning: **QuickJS** | Best learning/product fit for provider `.js` plugins with a controlled `ctx.host` API. |
| D5 | State management | Zustand · Redux · Context · Jotai | Leaning: **Zustand** | Likely enough for small multi-window/shared UI state without Redux ceremony. |
| D6 | Storage | SQLite · JSON files · sled | Leaning: **SQLite** | Local history/snapshots/querying are easier and more durable in a small embedded DB. |
| D7 | Secret storage | Windows Credential Manager · encrypted file · OS keyring crate | Leaning: **Credential Manager** | Secrets should not touch plaintext files, React state, logs, or SQLite. |

## Scaffold decision

Use the official `create-tauri-app` React TypeScript template with npm.

Why npm: this environment has Node/npm installed; pnpm, yarn, Rust/Cargo are not currently installed. Rust/Cargo are still required to compile and run the Tauri backend.

## Provider feasibility and integration pointers

| Provider | Status | Integration pointer |
|---|---|---|
| OpenAI Codex | 🟡 Fragile | Reuse Codex credentials from `~/.codex/auth.json`; poll the undocumented ChatGPT/Codex usage endpoint. Keep tokens inside the trusted host. |
| Anthropic Claude / Claude Code | 🟡 Fragile-works | One shared integration because usage limits are shared. Reuse Claude Code credentials from `~/.claude/.credentials.json`, combine endpoint usage with local JSONL where useful. |
| OpenCode Go | 🟡 Fragile-feasible | Embedded OpenCode login; authenticated workspace `/go` page; extract server-rendered `rollingUsage`, `weeklyUsage`, `monthlyUsage`, `resetInSec`, `usagePercent`, and `useBalance`. Backlog: contribute a read-only usage API upstream. |
| Antigravity (AGY) | 🟡 Fragile-feasible | Discover running AGY/Antigravity language-server local port and CSRF token; call loopback `GetUserStatus`; cache last successful quota snapshot and mark stale when closed. |
| Xiaomi MiMo Token Plan Lite | ⚪ Backlog optional | Public MiMo API access exists, but Token Plan quota tracking is not publicly documented. Dashboard inspection found `/tokenPlan/detail` and `/tokenPlan/usage`; response shape, reset semantics, and `tp-…` key read access remain unverified. |
| DeepSeek API balance | 🟢 Solid optional | User-supplied key stored in Windows Credential Manager; poll documented `/user/balance`; show total/granted/topped-up balances and availability. Do not label balance deltas as exact spend. |

## Technical risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | `rquickjs` may have Windows/MSVC build issues. | Test a trivial build before committing the plugin architecture to it; consider Windows GNU target or subprocess isolation if needed. |
| R2 | Tauri tray/window behavior has platform quirks. | Create tray programmatically in Rust and keep a tray-click fallback. |
| R3 | Undocumented provider endpoints can break. | Version parsers, validate response shapes, fail visibly, and keep fragile providers best-effort. |
| R4 | Provider secrets/session cookies are high-risk. | Keep secrets only in the trusted host; never expose to React, plugins, logs, or SQLite. |
| R5 | Xiaomi may require dashboard cookies instead of a read-only key. | Prefer verified `tp-…` read path; otherwise use embedded login with isolated session cookies if/when this backlog item is revived. |
| R6 | DeepSeek API key can infer, not just read balance. | Store only in Credential Manager and inject only into the trusted balance request. |

## Product and upstream backlog

- [ ] OpenCode Go read-only usage API: propose a small authenticated JSON endpoint around the existing subscription usage query.
- [ ] Antigravity always-available mode: evaluate only if stale-cache behavior is not enough.
- [ ] Xiaomi MiMo Token Plan Lite: revisit after core providers; capture sanitized `/tokenPlan/detail` and `/tokenPlan/usage` responses and test `tp-…` authorization.
- [ ] DeepSeek detailed usage: revisit only if DeepSeek publishes a documented usage API.

## Reference project takeaways

Rob Ebers' `openusage` is the main inspiration: Tauri + React, bundled provider plugins, a Rust plugin host, normalized metric lines, and a tray/menu-bar first UX. InfUsage should copy the proven shape, not the mature app's full surface area.

Use from `robinebers/openusage`:

- Provider plugin shape: manifest + `plugin.js` + `probe(ctx)`.
- Normalized output lines: progress, text, badge first; charts later.
- Provider docs beside implementations.
- Failure-tolerant provider behavior: hidden, stale, unavailable, and error states instead of crashes.
- Bounded provider probing once multiple providers exist.

Avoid until forced:

- Local HTTP API, proxy support, analytics, updater, autostart, global shortcuts, broad host capabilities, and multi-store React state.
- Copying OpenUsage's OpenCode Go local SQLite spend logic. InfUsage should use authenticated workspace quota extraction because OpenCode Go usage is workspace/subscription scoped across keys, members, and devices.

Jane Baraniewski's `openusage` is only a reference for terminal-first reporting ideas: local history, burn-rate concepts, CLI/headless reports, and zero-config detection. Its Go daemon/TUI architecture is not part of InfUsage.

## Phase 0 — Setup and foundational decisions

**Decisions:** D1, D2, D3.

**Build:**

- [x] Choose desktop shell: Tauri v2.
- [x] Choose frontend base: React + TypeScript + Vite.
- [x] Scaffold official Tauri React TypeScript template.
- [x] Ponytail trim scaffold: remove demo UI, demo IPC command, opener plugin, starter SVG assets, and stale build output.
- [x] Install npm dependencies.
- [x] Run frontend TypeScript/Vite build check.
- [x] Install/verify Rust prerequisites on Windows. Rust/Cargo worked for Phase 1; Visual Studio Build Tools not installed yet and deferred until a native build/link failure actually requires them.
- [x] Run first Tauri desktop dev check on Windows.
- [x] Decide D3 backend language: Rust inside Tauri, no sidecar/framework.

## Phase 1 — Tray shell

Ponytail scope: prove the desktop shell first, then add tray behavior. No settings window, global shortcut, updater, autostart, local HTTP API, plugin runtime, or provider code in this phase.

- [x] Decide first shell build target: window sanity check + minimal tray toggle.
- [x] Build the smallest useful Tauri shell: one main window.
- [x] Add tray icon with left-click toggle and Show/Quit menu.
- [x] Keep tray logic in Rust.
- [x] Windows checkpoint passed: `npm run tauri dev` showed tray icon, left-click toggled the window, close hid the window, and Quit exited the app.

## Phase 2 — Plugin host prototype

- Define `ctx.host`.
- Run a trivial provider plugin.
- Enforce host/guest boundaries.

## Phase 3 — First real provider

- Implement the first core provider after selecting build order.
- Keep credentials in the trusted host.

## Phase 4 — Storage and history

- Persist provider snapshots.
- Add basic history/detail views.

## Phase 5 — More providers

- OpenAI Codex provider.
- Anthropic Claude / Claude Code provider.
- OpenCode Go provider.
- Antigravity provider.
- Optional DeepSeek balance provider.
- Optional Xiaomi backlog provider only if evidence confirms a stable read path.

## Phase 6 — Polish and packaging

- Tray icon visualization.
- Error/stale states.
- Windows packaging.
