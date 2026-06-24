# InfUsage project

InfUsage is a Windows-native system-tray app for tracking AI inference usage and spend.

Core initial scope:

- OpenAI Codex
- Anthropic Claude / Claude Code as one shared-limits integration
- OpenCode Go
- Antigravity (AGY)

Optional/backlog:

- Xiaomi MiMo Token Plan Lite is backlog optional.
- DeepSeek API balance tracking is optional.

Current decided stack:

- D1 shell: Tauri v2.
- D2 frontend: React + TypeScript + Vite.
- D3 backend: Rust inside Tauri; no sidecar/framework.
- D4 plugin runtime: QuickJS via `rquickjs`.
- D7 secret storage: Windows Credential Manager via `keyring`.
- D6 storage: JSON file for latest snapshots only; usage history UI was removed as clutter and SQLite stays deferred until real query needs exist.
- D8 OpenCode quota auth: dev-only cookie paste path stores workspace id + cookie in Windows Credential Manager; local `auth.json` key is inference-only, final quota UX should become app-owned browser/session if kept.
- D9 OpenCode primary data: local read-only `opencode.db` spend/tokens, with Windows, Unix/WSL, `wsl.exe --cd ~ wslpath -w ...`, and `OPENCODE_DB` path discovery.
- Scaffold: official `create-tauri-app` template with npm.

Current branch:

- `codex/phase-3-providers` for current provider work.
- Dev/test should happen natively on Windows at `C:\Users\rupes\Documents\InfUsage`.

Phase 1 current shell:

- Minimal Tauri main window.
- Rust tray module creates a tray icon.
- Left-click toggles the main window.
- Tray menu has Show and Quit.
- Window close hides instead of exiting.
- Static popup UI shows the four core providers as not connected.
- Main window is a fixed-size tray popup and positions near the bottom-right when shown.
- Windows popup UI checkpoint passed after pulling latest `phase-1-shell`.
- Windows Phase 1 checkpoint passed with `npm run tauri dev`.
- Visual Studio Build Tools were not installed for the checkpoint; defer until a native build/link failure requires them.

Phase 2 current state:

- D4 decided: QuickJS via `rquickjs`.
- `rquickjs` builds on Windows.
- A trivial JavaScript provider runs through an injected `ctx.host` boundary in a Rust unit test.
- The prototype runner has a timeout, memory limit, stack limit, and basic output validation.

Phase 3 current state:

- First provider slice is DeepSeek balance.
- Rust owns the documented `/user/balance` HTTP/parser path.
- The DeepSeek JavaScript plugin normalizes host-provided balance JSON through `ctx.host`.
- DeepSeek API keys are saved through Rust into Windows Credential Manager.
- The popup can save one DeepSeek key, delete it to replace it, refresh balance, and render only USD remaining.
- Codex provider slice is in progress: Rust reads local Codex `auth.json`, refreshes expired login once, calls the undocumented usage endpoint, and exposes only plan/session remaining/session reset/weekly remaining/weekly reset/credits summary JSON to the plugin/UI.
- Claude provider slice is in progress: Rust reads local Claude Code `.credentials.json`, refreshes expired login once, calls the undocumented OAuth usage endpoint, and exposes only plan/session remaining/session reset/weekly remaining/weekly reset summary JSON to the plugin/UI.
- OpenCode Go provider slice is in progress: Rust reads local `opencode.db` spend/tokens read-only, filtered to `session.model` JSON `providerID = "opencode-go"`. Dev-only quota path stores a pasted OpenCode console cookie in Windows Credential Manager, fetches `/workspace/{workspaceId}/go`, and exposes sanitized quota lines. User's current OpenCode DB is in WSL Ubuntu at `/home/ruppy/.local/share/opencode/opencode.db`.
