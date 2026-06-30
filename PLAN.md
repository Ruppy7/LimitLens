# LimitLens — AI Usage and Limits Tracker for Windows

LimitLens is a Windows-native system-tray app that tracks AI usage, limits, and spend in one place. It is a real utility and a pairing/learning project.

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
| D6 | Storage | JSON file · SQLite · sled | ✅ **Decided: JSON file for latest snapshots** | Ponytail first step: persist latest provider snapshots with existing `serde_json` and no new database dependency. Usage history UI was removed as clutter; revisit SQLite only when real history queries need it. |
| D7 | Secret storage | Windows Credential Manager · encrypted file · OS keyring crate | ✅ **Decided: Windows Credential Manager via `keyring`** | Keeps provider keys out of plaintext files, React state after save, logs, and SQLite while using the native Windows credential store. |
| D8 | OpenCode Go quota auth | Reuse local `auth.json` key · app-owned console session cookie · cookie paste | Experimental: **cookie-backed console quota** | Verified 2026-06-24: the local `~/.local/share/opencode/auth.json` `opencode-go` entry is a static `sk-…` **inference** key for `opencode.ai/zen/(go/)v1` only — usage/quota fields appear nowhere in the CLI binary. Usage quota is served by the console, GET `https://opencode.ai/workspace/{workspaceId}/go` (text/html, SolidStart/Seroval-serialized), authenticated by **session cookie**. Managed-webview login was prototyped but rejected because it forces a fresh in-app Google OAuth. Current implementation stores a pasted cookie in Windows Credential Manager and treats it as the main OpenCode path, but it remains experimental until OpenCode exposes a stable read-only API or a cleaner app-owned session flow. |
| D9 | OpenCode Go primary data | Console quota (cookie) · local SQLite spend | ✅ **Decided: console Go limits only in app** | Local `opencode.db` spend is this-device only, adds WSL/SQLite probing work, and does not answer the main quota question. The app shows only authenticated Go limits from the console page. The unused `opencode_db.rs` reader and bundled `rusqlite` dependency were removed during PR review; keep local DB reading documented as a viable fallback idea, but re-add it only as a real user-facing feature. |
| D10 | Tray visual baseline | Native window chrome · custom undecorated panel · full design system | ✅ **Decided: custom compact tray panel** | Current Phase 6 baseline is a fixed `400x540` undecorated popup with a custom draggable header, compact provider cards, status chips, icon buttons, and `lucide-react`. Keep this simple until the remaining provider, error, and stale states are stable. |
| D11 | Tray visual language | Teal-glass "AI-slop" · ink + one signal accent · warm sand · terminal dev-tool | ✅ **Decided: ink + amber signal accent** | Replaces the radial-blue-glow + teal-glass template look with near-monochrome graphite neutrals, hairline 1px borders, 6px corners, flat surfaces (no glare/blur shadows). Amber is the single attention accent, reserved for usage bars and the stale lifecycle state so the only color on screen is your actual data. Provider logos sit on a neutral plate (brand colors), removing the dark-mode `invert(1)` hack. Custom inline SVG brand mark replaces the generic `Activity`/`Gauge` icons. |
| D12 | Provider management surface | Inline card action rows · dedicated settings sheet · per-card popovers | ✅ **Decided: dedicated settings sheet** | Gear opens an in-popup slide-over titled sheets containing Display mode, DeepSeek key add/replace/delete, and OpenCode Go-limits link/disconnect. Tray cards become glanceable read-only summaries (logo + name + auth dot + lifecycle chip + metrics + age + single Refresh). Removes the cramped minimal-mode action rows and the empty "settings only toggles view" problem. Kepler: one window, no second Tauri window; back button replaces the gear while settings is open. |
| D13 | Per-provider status model | Mixed-meaning single chip · lifecycle chip + separate auth dot · minimal dot + tooltip | ✅ **Decided: lifecycle chip + separate auth dot** | One chip carries a fixed state set: `refreshing` (spinner, zinc) · `fresh` (zinc) · `stale`, amber, soft bg) · `error` (red soft bg + inline Retry) · `empty` (provider-specific "No API key" / "Local login needed"). Connection/auth becomes a separate green dot, orthogonal. View labels move off the chip onto settings toggles (`Device` / `Go limits`). Stale threshold = 15m with a minute timer. Per-provider `refreshing`/`error` state replaces the single overwritten global status string. |
| D14 | Tray appearance mode | System-only · explicit light/dark · full named themes | ✅ **Decided: system + light/dark override** | Keep the current ink + amber palette as the default visual language, with Settings offering System/Dark/Light. Matrix, Tokyo Night, and purple variants stay future theme-pack ideas because named palettes are subjective and can distract from finishing the core utility. |
| D15 | Tray placement | Always tray-attached · floating/popped-out mode · separate pinned window | ✅ **Decided: floating mode on same window** | Header pin toggles a popped-out mode that preserves the user's dragged position and stops tray/show/display changes from snapping the popup back to the tray corner. Turning it off reattaches the same window near the tray. No second window or docking system yet. |
| D16 | Refresh cadence | Manual only · fixed timer · editable timer | ✅ **Decided: manual + optional periodic refresh** | Header has a global refresh button for all connected providers plus per-provider refresh buttons. Settings has a Regular global refresh toggle; when enabled, it exposes a 5-120 minute interval, default 15m, to avoid hammering fragile provider endpoints while keeping tray data fresh. |
| D17 | Distribution for now | Source/CLI · unsigned installers · signed release | ✅ **Decided: GitHub Actions unsigned releases** | Normal users should not need to run the app from CLI. Until code-signing is realistic, ship GitHub Actions-built unsigned NSIS installer + portable zip + SHA256 checksums through GitHub Releases, with clear SmartScreen/unknown-publisher caveats and source-build instructions for verification. Signed releases remain a later upgrade. |
| D18 | Product name | InfUsage · QuotaDock · LimitLens · TokenTray | ✅ **Decided: LimitLens** | `InfUsage` was a working name. LimitLens is smoother, less implementation-shaped, and covers usage, limits, balance, and reset visibility. Update app identity now before installer work. Keep the repo URL and legacy Credential Manager service name until after installer smoke tests, then migrate deliberately if needed. |
| D19 | Glance surface | Tray tooltip/badge · draggable glance widget · taskbar overlay/native shell extension | ✅ **Decided: draggable always-on-top glance widget** | Windows taskbar overlay behavior is too brittle for the long run. Keep the glance surface as a small draggable always-on-top window with remembered position. It shows provider icon + current remaining percent + weekly remaining percent, while the tray icon still opens the full dashboard. Priority-based provider fitting remains a later iteration. |

| D20 | Main window direction | Fixed tray popup with Focus/Dashboard toggle - resizable dashboard app - separate compact/full windows | Planned: **resizable responsive dashboard** | The glance widget now covers the quick-focus job. Next, evolve the main window into the complete dashboard surface: resizable, analytics-friendly, and able to collapse into compact layouts below breakpoints instead of keeping a permanent Focus view. Exact breakpoint and taskbar behavior remain open until the first dashboard resize spike. |

## Scaffold decision

Use the official `create-tauri-app` React TypeScript template with npm.

Why npm: this environment has Node/npm installed; pnpm, yarn, Rust/Cargo are not currently installed. Rust/Cargo are still required to compile and run the Tauri backend.

## Provider feasibility and integration pointers

| Provider | Status | Integration pointer |
|---|---|---|
| OpenAI Codex | 🟡 Fragile | Reuse Codex credentials from `~/.codex/auth.json`; poll the undocumented ChatGPT/Codex usage endpoint. Keep tokens inside the trusted host. |
| Anthropic Claude / Claude Code | 🟡 Fragile-works | One shared integration because usage limits are shared. Reuse Claude Code credentials from `~/.claude/.credentials.json`, combine endpoint usage with local JSONL where useful. |
| OpenCode Go | 🟡 Experimental quota path works | Active app path reads authenticated Go limits only. Verified quota contract (2026-06-24): GET `https://opencode.ai/workspace/{workspaceId}/go` returns quota under a session cookie; current path stores a pasted cookie in Credential Manager, fetches the document, and exposes sanitized quota only. Local `opencode.db` spend is safer because it avoids a web session cookie, but it is this-device-only and remains a documented alternative, not shipped app code. |
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
| R7 | Token refresh writes back to the Codex/Claude CLI credential files. | Only a refresh-once path, low probability of concurrent CLI+InfUse overlap. If CLI runs a refresh while InfUse refreshes, last-write-wins could orphan a `refresh_token`. No lock file yet; revisit only if a user hits a forced re-login. |

## Product and upstream backlog

- See `docs/feature-roadmap.md` for the living feature tracker, provider expansion plan, and future implementation sequencing.
- [ ] OpenCode Go read-only usage API: propose a small authenticated JSON endpoint around the existing subscription usage query.
- [ ] OpenCode Go app-owned browser session: replace dev cookie paste if subscription-wide quota stays useful; store an isolated OpenCode console session in the Tauri app, then call authenticated console data paths.
- [ ] Antigravity always-available mode: evaluate only if stale-cache behavior is not enough.
- [ ] Xiaomi MiMo Token Plan Lite: revisit after core providers; capture sanitized `/tokenPlan/detail` and `/tokenPlan/usage` responses and test `tp-…` authorization.
- [ ] DeepSeek detailed usage: revisit only if DeepSeek publishes a documented usage API.

## Reference project takeaways

Rob Ebers' `openusage` is the main inspiration: Tauri + React, bundled provider plugins, a Rust plugin host, normalized metric lines, and a tray/menu-bar first UX. LimitLens should copy the proven shape, not the mature app's full surface area.

Use from `robinebers/openusage`:

- Provider plugin shape: manifest + `plugin.js` + `probe(ctx)`.
- Normalized output lines: progress, text, badge first; charts later.
- Provider docs beside implementations.
- Failure-tolerant provider behavior: hidden, stale, unavailable, and error states instead of crashes.
- Bounded provider probing once multiple providers exist.

Avoid until forced:

- Local HTTP API, proxy support, analytics, updater, autostart, global shortcuts, broad host capabilities, and multi-store React state.
- Treating OpenCode local SQLite spend as subscription quota. It is a viable fallback idea, not active app data.
- Treating pasted OpenCode session cookies as permanently stable UX. Current cookie path is the main experimental implementation; product path should become app-owned session handling or an upstream read-only API when available.

Jane Baraniewski's `openusage` is only a reference for terminal-first reporting ideas: local history, burn-rate concepts, CLI/headless reports, and zero-config detection. Its Go daemon/TUI architecture is not part of LimitLens.

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
- [x] Switch dev/test workflow to native Windows.

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
- [x] OpenCode Go checkpoint: validate subscription quota through the experimental Credential Manager cookie path; local `opencode.db` device spend remains a documented fallback idea.
- [ ] Antigravity checkpoint: start Antigravity or `agy`, then discover the local language server and call `GetUserStatus`.

## Phase 4 — Storage

- [x] Persist latest provider snapshots to an app-data JSON file after successful refresh.
- [x] Restore saved Codex, Claude, and DeepSeek snapshots on tray startup.
- [x] Show a compact last-updated timestamp for restored/refreshed provider rows.
- [x] Remove recent history rows from the tray popup; latest snapshot restore is enough for now.

## Phase 5 — More providers

- OpenAI Codex provider deeper follow-ups only if needed: reset timing, stale state, plan labels, model-specific limits.
- Anthropic Claude / Claude Code deeper follow-ups only if needed: OS credential lookup, local token-spend history, model-specific weekly limits, extra usage credits.
- OpenCode Go provider.
- Antigravity provider.
- Optional DeepSeek balance provider.
- Optional Xiaomi backlog provider only if evidence confirms a stable read path.

## Phase 6 — Polish and public readiness

- [x] Initial tray visual refresh: custom undecorated popup hidden from the normal taskbar, compact cards, status chips, green connection dots, icon buttons, global/per-provider refresh, editable periodic refresh, OpenCode Go-limits connection row, Focus/Dashboard display control, System/Dark/Light setting, floating pop-out toggle, dimmed light mode, tray-open/close animation, and tighter spacing/typography.
- [x] Add draggable always-on-top glance window showing compact remaining quota for Codex, Claude, and OpenCode, using `5h | weekly` style values and the tray icon/main window for the expansive dashboard view.
- [x] Enable local NSIS installer build for smoke testing.
- [x] Decide public install path: GitHub Actions-built unsigned installer + portable zip + SHA256 checksums; signed installer later.
- [x] Rename product/app identity from InfUsage to LimitLens before installer work.
- [ ] Add open-source guardrails: `CONTRIBUTING.md`, `SECURITY.md`, issue templates, PR template, and optional code of conduct.
- [ ] Add `PRIVACY.md` covering local credentials, OpenCode cookie handling, Windows Credential Manager, provider API calls, snapshots, and no telemetry.
- [ ] Add a lightweight threat model for provider secrets, OpenCode cookies, plugin sandbox boundary, local filesystem access, provider response parsing, and unsigned installer trust.
- [ ] Add CI for PRs: `npm ci`, `npm run build`, `cargo test`, and formatting/whitespace checks.
- [ ] Add release workflow for `v*` tags: validate versions, build Windows NSIS installer, build portable zip, generate SHA256 checksums, and upload artifacts to a GitHub Release.
- [ ] Add dependency/security checks: `npm audit`, Rust dependency audit, and license review where practical.
- [ ] Verify installer lifecycle: fresh install, upgrade over existing version, uninstall behavior, taskbar/tray behavior, and credential/snapshot persistence expectations.
- [ ] Verify crash/log behavior: no secrets, cookies, auth tokens, or personal fields in logs, errors, snapshots, frontend state, or generated artifacts.
- [ ] Improve README for public users: Download, security/privacy caveats, provider setup, WSL notes, source build, screenshots, and troubleshooting.
- [ ] Add marketing assets: polished screenshots first; short demo/animation/video for LinkedIn and Twitter after the app surface is stable.
- [ ] Full security audit before public announcement; prefer a separate reviewer/agent for a fresh view.
- [ ] Rename remaining public project surface from `InfUsage` to `LimitLens`: GitHub repo URL, local folder references, clone commands, release links, and any generated package metadata.
- [ ] Migrate Windows Credential Manager service from legacy `InfUsage` to `LimitLens` with fallback support so existing saved secrets are not lost.
- [ ] Signed Windows installer only when a code-signing certificate becomes practical.

## Deferred rename cleanup

- Rename GitHub repo/folder from `InfUsage` to `LimitLens` before public release.
- Remove this section after the rename and Credential Manager migration tasks above are complete.
