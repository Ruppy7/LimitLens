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
- Scaffold: official `create-tauri-app` template with npm.

Current branch:

- `phase-1-shell` for the first desktop shell/tray work.

Phase 1 current shell:

- Minimal Tauri main window.
- Rust tray module creates a tray icon.
- Left-click toggles the main window.
- Tray menu has Show and Quit.
- Window close hides instead of exiting.
- Windows Phase 1 checkpoint passed with `npm run tauri dev`.
- Visual Studio Build Tools were not installed for the checkpoint; defer until a native build/link failure requires them.
