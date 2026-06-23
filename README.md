# InfUsage

Windows-native system-tray app for tracking AI inference usage and spend.

## Current status

- D1 shell: Tauri v2.
- D2 frontend: React + TypeScript + Vite.
- Scaffold: official Tauri React TypeScript template using npm.

Core providers planned:

- OpenAI Codex
- Anthropic Claude / Claude Code
- OpenCode Go
- Antigravity (AGY)

Optional/backlog:

- Xiaomi MiMo Token Plan Lite
- DeepSeek API balance tracking

## Development

Install dependencies:

```bash
npm install
```

Build the web frontend:

```bash
npm run build
```

Run the Tauri desktop app:

```bash
npm run tauri dev
```

`npm run tauri dev` requires Rust/Cargo and OS-specific Tauri prerequisites. This environment currently has Node/npm but not Rust/Cargo.

For Windows setup, see [docs/windows-dev-setup.md](docs/windows-dev-setup.md).

Phase 1 tray checkpoint must be tested from Windows, not WSL:

- tray icon appears
- left-click toggles the main window
- closing the window hides it
- tray menu `Show` restores it
- tray menu `Quit` exits the app

## Project docs

- `PLAN.md` — scope, phases, and decision log.
- `AGENTS.md` — collaboration rules for AI agents.
- `memory/` — condensed project facts.

## License

MIT
