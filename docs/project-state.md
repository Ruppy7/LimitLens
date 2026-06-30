# Project State

Last checked: 2026-06-30

## Current baseline

- Product name: LimitLens.
- GitHub repo: `https://github.com/Ruppy7/LimitLens`.
- Main development branch: `main`.
- Current merged commit: `9c6e339` (`Fix v0.1 audit follow-ups (#2)`).
- Active feature branch: `codex/glance-window`.
- Stack: Tauri v2, React, TypeScript, Vite, Rust.
- Package manager: npm.
- Distribution: unsigned Windows NSIS installer, portable zip, and SHA256 checksums through GitHub Releases.
- Latest public release: `v0.1.0`.

## App state

- Windows tray app with a compact undecorated popup.
- Focus and Dashboard display modes remain in the main popup for now.
- A draggable always-on-top glance window is implemented on `codex/glance-window`; it shows compact remaining quota values and opens the main dashboard on click.
- Provider cards, status chips, per-provider refresh, global refresh, optional periodic refresh, theme setting, and floating pop-out.
- App window is skipped from the normal taskbar.

## Provider state

- Codex: reads Windows-native Codex auth and shows quota/reset summary.
- Claude: reads Windows-native Claude credentials and shows quota/reset summary.
- DeepSeek: optional API balance check via a saved key in Windows Credential Manager.
- OpenCode Go: experimental cookie-backed quota flow against the authenticated workspace page.
- OpenCode local SQLite spend: documented fallback idea only, not shipped app code.
- Antigravity: pending.

## Recent cleanup

- `v0.1.0` is released and public.
- LinkedIn launch post is done.
- Audit follow-up PR #2 is merged.
- Completed local/remote work branches were deleted after the v0.1 cleanup; new feature work now happens on `codex/<feature-name>` branches.
- CSP no longer allows inline styles.
- Snapshot writes are atomic.
- Provider 429 responses return explicit rate-limit messages.

## Branch, PR, and release workflow

- `main` is the stable integration branch.
- Feature work should happen on scoped branches such as `codex/glance-window` or `codex/resizable-dashboard`.
- Each meaningful feature or architecture change gets a PR into `main`; the PR is the review checkpoint with summary, checks, and screenshots where useful.
- Versioned public builds should come from tags such as `v0.1.1` or `v0.2.0`, not directly from feature branches.
- Patch releases (`v0.1.x`) are for fixes and small safe improvements. Minor releases (`v0.2.0`) are for larger user-facing batches such as dashboard evolution or provider expansion.

## Documentation scope

`PLAN.md` and `docs/feature-roadmap.md` are tracked planning docs as of the glance-window branch. `AGENTS.md`, `memory/`, and some other local notes may remain ignored or local-only. Public-facing information belongs in `README.md`, `SECURITY.md`, `PRIVACY.md`, `THREAT_MODEL.md`, and release notes.
