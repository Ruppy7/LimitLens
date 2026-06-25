# InfUsage

InfUsage is a Windows tray app for checking AI usage, limits, and balance without opening every provider dashboard.

It is built with Tauri, React, TypeScript, and Rust. Provider credentials and session data are kept in Windows Credential Manager where possible, and the UI shows only sanitized usage summaries.

## Providers

- OpenAI Codex: reads local Codex auth and shows quota/reset summary.
- Claude: reads local Claude credentials and shows quota/reset summary.
- OpenCode Go: shows authenticated Go limits from the OpenCode workspace page.
- DeepSeek: optional API balance check, showing USD balance.

## Usage

For now, InfUsage is source-first. Clone the repo, install dependencies, and run it locally:

```powershell
git clone https://github.com/Ruppy7/InfUsage.git
cd InfUsage
npm install
npm run tauri dev
```

Build checks:

```powershell
npm run build
cd src-tauri
cargo test
```

InfUsage does not publish binaries or installers yet. Use the source workflow above until release packaging is ready.

## OpenCode Go

OpenCode Go limits currently use an experimental cookie-backed flow:

1. Log in to OpenCode in your browser.
2. Open your Go workspace page:

```text
https://opencode.ai/workspace/<your-workspace-id>/go
```

3. In InfUsage settings, paste either the workspace URL or the `wrk_...` id.
4. Paste the `Cookie` request header from that logged-in browser request.

The cookie is stored in Windows Credential Manager and used only by the Rust host to fetch quota fields. This may break if OpenCode changes the page shape or session behavior.

Alternative approach: OpenCode also keeps local usage data in `opencode.db`. Reading that database avoids browser cookies and is a viable future fallback, but it only reflects usage from that local device/profile, so it is less accurate than authenticated workspace quota for users who switch between Windows, WSL, or other machines.

## Caveats

- Windows is the primary target.
- Provider usage endpoints can change without notice.
- OpenCode Go support is experimental.
- No official binaries or signed installers are published yet.
- Provider logos and names belong to their respective owners.

## Planned

- Final app icon and branding.
- Public release packaging and signing.
- Better provider setup flows.
- Antigravity support if a stable local or authenticated usage source is available.

## License

MIT
