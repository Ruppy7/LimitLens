# AGENTS.md - LimitLens

## What this project is

**LimitLens** is a Windows-native system-tray app that tracks AI usage, limits, and spend. The initial product targets OpenAI Codex, Anthropic Claude/Claude Code (shared usage limits), OpenCode Go, and Antigravity (AGY), with backlog-optional Xiaomi MiMo Token Plan Lite and optional DeepSeek API balance integrations. Fork of / inspired by [openusage](https://github.com/robinebers/openusage). It is **both a real app the user will use and a learning project** - read `PLAN.md`, the source of truth for scope, phases, and the decision log.

## How to work on this project (important)

This is a **pair-programming learning project**. The user knows JS/React/Python and some architecture but is not a full-time coder. The AI writes the code; **the user drives the decisions and learns the reasoning.** Optimize for the user's understanding, not just working code.

The session rhythm:

```text
Decision -> Concept -> Build -> Checkpoint
```

Rules:

- **No silent technical choices.** Before writing code for something, have the decision conversation: name 2-3 real alternatives, give a recommendation **with reasoning**, let the user overrule.
- Tech choices are treated as **open and re-derived together**, even where `PLAN.md` shows a leaning.
- Surface **key concepts in context** and connect them to transferable ideas.
- **Rust = read-fluency.** Annotate unfamiliar syntax inline the first few times, with JS/Python analogies.
- Keep the decision log in `PLAN.md` updated as choices land.

## Current stack decisions

- **D1 Shell:** Tauri v2.
- **D2 Frontend:** React + TypeScript + Vite.
- **D3 Backend:** Rust inside Tauri; no Node/Go sidecar.
- **D4 Plugin runtime:** QuickJS via `rquickjs`.
- **D6 Storage:** JSON file for latest provider snapshots only; no usage history UI for now.
- **D7 Secrets:** Windows Credential Manager via `keyring`.
- **D17 Distribution:** GitHub Actions-built unsigned Windows releases for now: NSIS installer, portable zip, and SHA256 checksums. Signed installer is deferred until code-signing is practical.
- **D18 Product name:** LimitLens. Rename the public repo URL/folder before public release. Legacy Credential Manager service can remain `InfUsage` only until a fallback migration is implemented.
- **Package manager:** npm, because it is installed in the current environment while pnpm/yarn are not.
- **Branch naming:** Use conventional branch prefixes such as `feat/`, `fix/`, `docs/`, `chore/`, or `refactor/`. Do not create new `codex/` branches.

## Leaning stack, still to be decided

- **HTTP:** `reqwest`.
- **State management:** Zustand only if React state becomes messy enough to justify it.

## Current product state

- Current branch style: feature work should use branches like `feat/resizable-dashboard`; older `codex/*` branches may still exist historically.
- The tray popup is a compact undecorated `400x540` window with a custom draggable header, compact provider cards, status chips, icon buttons, and `lucide-react` icons.
- DeepSeek balance, Codex quota, Claude quota, and OpenCode Go limits are wired through the host/plugin flow.
- OpenCode local SQLite spend is a viable fallback idea but is not shipped app code right now.
- OpenCode quota uses an experimental cookie path stored in Windows Credential Manager; do not treat pasted cookies as permanently stable UX.
- Public README should offer a normal Windows download path once release automation exists, while clearly noting unsigned installer caveats and keeping source-build instructions for verification.
- Preserve existing credentials: `src-tauri/src/secrets.rs` intentionally keeps the legacy `InfUsage` Credential Manager service name until a migration path exists, but this is a release-readiness task.
- Antigravity remains pending.

## Architectural centerpiece

A sandboxed **plugin system**: each provider is a self-contained `.js` plugin that can only touch the system through an injected `ctx.host` object (capability-based security). Understanding the **host/guest boundary** is the core learning goal of the project.

## Key locations

- `PLAN.md` - full plan, phases, decision log, concept index.
- `memory/` - local agent memory, ignored by git for public commits.
- `src-tauri/` - Rust backend.
- `src/` - React frontend.
