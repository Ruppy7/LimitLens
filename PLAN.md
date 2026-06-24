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
| D4 | Plugin runtime | QuickJS sandbox · WASM · native Rust modules · subprocess | ✅ **Decided: QuickJS via `rquickjs`** | Best learning/product fit for provider `.js` plugins with a controlled `ctx.host` API; the Windows build spike passed in Phase 2. |
| D5 | State management | Zustand · Redux · Context · Jotai | Leaning: **Zustand** | Likely enough for small multi-window/shared UI state without Redux ceremony. |
| D6 | Storage | JSON file · SQLite · sled | ✅ **Decided: JSON file for snapshots/history** | Ponytail first step: persist provider snapshots and a capped recent history with existing `serde_json` and no new database dependency. Revisit SQLite only when real history queries need it. |
| D7 | Secret storage | Windows Credential Manager · encrypted file · OS keyring crate | ✅ **Decided: Windows Credential Manager via `keyring`** | Keeps provider keys out of plaintext files, React state after save, logs, and SQLite while using the native Windows credential store. |
| D8 | OpenCode Go quota auth | Reuse local `auth.json` key · app-owned console session cookie | Deferred: **app-owned console session only if quota is revived** | Verified 2026-06-24: the local `~/.local/share/opencode/auth.json` `opencode-go` entry is a static `sk-…` **inference** key for `opencode.ai/zen/(go/)v1` only — usage/quota fields appear nowhere in the CLI binary. Usage quota is served by the console, GET `https://opencode.ai/workspace/{workspaceId}/go` (text/html, SolidStart/Seroval-serialized), authenticated by **session cookie**. Managed-webview login was prototyped but rejected because it forces a fresh in-app Google OAuth. Cookie paste was also cut for now: it is sensitive auth material and not needed for the primary local-spend slice. |
| D9 | OpenCode Go primary data | Console quota (cookie) · local SQLite spend | ✅ **Decided: local SQLite spend is primary** | Every other OpenCode tracker (openusage.sh, gaboe/opencode-usage, PyPI opencode-usage, robinebers/openusage) reads the local `opencode.db` with zero auth; none scrape console quota. Verified our `session` table exposes `cost` + `tokens_*` (ms timestamps) and `model` JSON with `providerID`. InfUsage reads `opencode.db` read-only for per-window spend/tokens, filtered to `providerID = "opencode-go"`, checking Windows `%LOCALAPPDATA%`, Unix/WSL `~/.local/share`, WSL `wslpath`, and an `OPENCODE_DB` override. Forces a SQLite reader → added `rusqlite` (bundled) per D3's "add crates only when a feature requires it." Caveat: local spend is this-device/this-machine, not subscription-wide; quota remains a later app-owned browser/session problem. |

## Scaffold decision

Use the official `create-tauri-app` React TypeScript template with npm.

Why npm: this environment has Node/npm installed; pnpm, yarn, Rust/Cargo are not currently installed. Rust/Cargo are still required to compile and run the Tauri backend.

## Provider feasibility and integration pointers

| Provider | Status | Integration pointer |
|---|---|---|
| OpenAI Codex | 🟡 Fragile | Reuse Codex credentials from `~/.codex/auth.json`; poll the undocumented ChatGPT/Codex usage endpoint. Keep tokens inside the trusted host. |
| Anthropic Claude / Claude Code | 🟡 Fragile-works | One shared integration because usage limits are shared. Reuse Claude Code credentials from `~/.claude/.credentials.json`, combine endpoint usage with local JSONL where useful. |
| OpenCode Go | 🟡 Local spend works / quota deferred | Primary path reads `opencode.db` read-only for local spend/tokens. WSL homes are checked because the user's OpenCode runs inside WSL. Verified quota contract (2026-06-24): GET `https://opencode.ai/workspace/{workspaceId}/go` returns quota under a session cookie; keep this deferred until an app-owned browser/session flow is worth the UX cost. |
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
- [ ] OpenCode Go app-owned browser session: only if subscription-wide quota becomes worth it; store an isolated OpenCode console session in the Tauri app, then call authenticated console data paths instead of asking for pasted cookies.
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
- Treating OpenCode local SQLite spend as subscription quota. It is useful local spend/tokens, not workspace-wide quota across devices, keys, and members.
- Asking users to paste OpenCode session cookies. If quota comes back, the product path should be app-owned session handling or an upstream read-only API.

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
- [x] Switch dev/test workflow to native Windows at `C:\Users\rupes\Documents\InfUsage`.

## Phase 1 — Tray shell

Ponytail scope: prove the desktop shell first, then add tray behavior. No settings window, global shortcut, updater, autostart, local HTTP API, plugin runtime, or provider code in this phase.

- [x] Decide first shell build target: window sanity check + minimal tray toggle.
- [x] Build the smallest useful Tauri shell: one main window.
- [x] Add tray icon with left-click toggle and Show/Quit menu.
- [x] Keep tray logic in Rust.
- [x] Windows checkpoint passed: `npm run tauri dev` showed tray icon, left-click toggled the window, close hid the window, and Quit exited the app.
- [x] Replace starter placeholder with minimal static tray-panel UI and provider placeholders.
- [x] Windows popup UI checkpoint passed: latest branch pulled on Windows and static provider panel renders correctly.
- [x] Add handoff doc for Windows/Codex Desktop workflow.
- [x] Make the main window behave more like a tray popup: smaller fixed size, no maximize button, and bottom-right positioning when shown.

## Phase 2 — Plugin host prototype

- [x] Define the first tiny host/provider contract in Rust.
- [x] Add `rquickjs` and verify it builds on Windows.
- [x] Run a trivial JavaScript provider through an injected `ctx.host` boundary in a unit test.
- [x] Enforce tighter host/guest boundaries before real providers: timeout, memory limit, stack limit, and output validation.

## Phase 3 — First real provider

- [x] Select DeepSeek balance as the first provider slice because its balance API is documented.
- [x] Add trusted-host DeepSeek `/user/balance` HTTP/parser module.
- [x] Add a JavaScript DeepSeek plugin that normalizes host-provided balance JSON through `ctx.host`.
- [x] Add UI/API-key flow backed by Windows Credential Manager.
- [x] Support one saved DeepSeek key and show only USD remaining.
- [x] Keep credentials in the trusted host.
- [x] Add a minimal Codex provider slice: Rust reads local Codex auth, refreshes expired login once, calls the undocumented usage endpoint, and exposes only sanitized remaining-quota/reset summary JSON to the JavaScript plugin.
- [ ] Windows checkpoint: verify Codex refresh from the tray popup against the user's local Codex login.
- [x] Add a minimal Claude / Claude Code provider slice: Rust reads local Claude Code credentials, refreshes expired login once, calls the undocumented OAuth usage endpoint, and exposes only sanitized remaining-quota/reset summary JSON to the JavaScript plugin.
- [ ] Windows checkpoint: verify Claude refresh from the tray popup against the user's local Claude Code login.
- [x] Keep the fixed tray panel usable as provider rows grow by making the provider list scroll within the popup.
- [ ] OpenCode Go checkpoint: read local `opencode.db` spend/tokens read-only, including WSL paths, and defer subscription quota until an app-owned browser/session flow is worth building.
- [ ] Antigravity checkpoint: start Antigravity or `agy`, then discover the local language server and call `GetUserStatus`.

## Phase 4 — Storage and history

- [x] Persist latest provider snapshots to an app-data JSON file after successful refresh.
- [x] Restore saved Codex, Claude, and DeepSeek snapshots on tray startup.
- [x] Show a compact last-updated timestamp for restored/refreshed provider rows.
- [x] Add basic capped recent history rows under each connected provider.

## Phase 5 — More providers

- OpenAI Codex provider deeper follow-ups only if needed: reset timing, stale state, plan labels, model-specific limits.
- Anthropic Claude / Claude Code deeper follow-ups only if needed: OS credential lookup, local token-spend history, model-specific weekly limits, extra usage credits.
- OpenCode Go provider.
- Antigravity provider.
- Optional DeepSeek balance provider.
- Optional Xiaomi backlog provider only if evidence confirms a stable read path.

## Phase 6 — Polish and packaging

- Tray icon visualization.
- Error/stale states.
- Windows packaging.
