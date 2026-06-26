# LimitLens

LimitLens is a Windows tray app for checking AI usage, limits, and balance without opening every provider dashboard.

It is built with Tauri, React, TypeScript, and Rust. Provider credentials and session data are kept in Windows Credential Manager where possible, and the UI shows only sanitized usage summaries.

## Providers

- OpenAI Codex: reads local Codex auth and shows quota/reset summary.
- Claude: reads local Claude credentials and shows quota/reset summary.
- OpenCode Go: shows authenticated Go limits from the OpenCode workspace page.
- DeepSeek: optional API balance check, showing USD balance.

## Download

LimitLens publishes Windows builds through [GitHub Releases](https://github.com/Ruppy7/LimitLens/releases).

- Unsigned NSIS installer: `LimitLens_<version>_x64-setup.exe`
- Portable zip: `LimitLens_<version>_x64-portable.zip`
- Checksums: `SHA256SUMS.txt`

The Windows builds are unsigned for now, so Windows may show SmartScreen or unknown-publisher warnings. If you prefer to verify the app yourself, build it from source.

## Build from Source

Clone the repo, install dependencies, and run it locally:

```powershell
git clone https://github.com/Ruppy7/LimitLens.git
cd LimitLens
npm install
npm run tauri dev
```

Build checks:

```powershell
npm run build
cd src-tauri
cargo test
```

Build a local Windows installer:

```powershell
npm run tauri -- build
```

The unsigned NSIS installer is written to:

```text
src-tauri\target\release\bundle\nsis\
```

Official signed release binaries are not published yet.

## OpenCode Go

OpenCode Go limits currently use an experimental cookie-backed flow:

1. Log in to OpenCode in your browser.
2. Open your Go workspace page:

```text
https://opencode.ai/workspace/<your-workspace-id>/go
```

3. In LimitLens settings, paste either the workspace URL or the `wrk_...` id.
4. Paste the `Cookie` request header from that logged-in browser request.

The cookie is stored in Windows Credential Manager and used only by the Rust host to fetch quota fields. This may break if OpenCode changes the page shape or session behavior.

Alternative approach: OpenCode also keeps local usage data in `opencode.db`. Reading that database avoids browser cookies and is a viable future fallback, but it only reflects usage from that local device/profile, so it is less accurate than authenticated workspace quota for users who switch between Windows, WSL, or other machines.

## Claude Code on WSL

LimitLens is a Windows-native app, so it reads Claude Code credentials from your Windows profile.

If you normally use Claude Code inside WSL, sign in once from Windows Claude Code so Windows has its own credentials. Alternatively, copy your WSL Claude credentials into the matching Windows Claude profile folder. After that, refresh Claude in LimitLens.

## Caveats

- Windows is the primary target.
- Provider usage endpoints can change without notice.
- OpenCode Go support is experimental.
- Windows installers are unsigned until code-signing is practical.
- Provider logos and names belong to their respective owners.

## Security and Privacy

- See [SECURITY.md](SECURITY.md) for vulnerability reporting and security expectations.
- See [PRIVACY.md](PRIVACY.md) for what stays local and what is sent to providers.
- See [THREAT_MODEL.md](THREAT_MODEL.md) for the current lightweight threat model.

## Planned

- Signed release packaging.
- Better provider setup flows.
- Antigravity support if a stable local or authenticated usage source is available.

## License

MIT
