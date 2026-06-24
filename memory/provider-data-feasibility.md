# Provider data feasibility

| Provider | Status | Notes |
|---|---|---|
| OpenAI Codex | Fragile | Reuse local Codex `auth.json`; undocumented `https://chatgpt.com/backend-api/wham/usage`; keep tokens in Rust and expose only sanitized summary JSON. |
| Anthropic Claude / Claude Code | Fragile-works | Shared limits; reuse local Claude Code `.credentials.json`; undocumented `https://api.anthropic.com/api/oauth/usage`; keep tokens in Rust and expose only sanitized summary JSON. |
| OpenCode Go | Feasible (local) / Fragile (quota) | **Primary = local SQLite spend (zero auth).** Read `opencode.db` read-only (Windows `%LOCALAPPDATA%/opencode/opencode.db`; Unix/WSL `~/.local/share/opencode/opencode.db`; `OPENCODE_DB` override); `session` table has `cost`, `tokens_input/output/...`, `time_created/updated` (ms). This is the approach every other tracker uses (openusage.sh etc.); it's this-device spend, not subscription quota. **Quota is deferred.** GET `https://opencode.ai/workspace/{workspaceId}/go` can return `{ mine, useBalance, rollingUsage, weeklyUsage, monthlyUsage }` under a session cookie, but cookie paste was cut and webview login was rejected for UX. The local `auth.json` `opencode-go` `sk-...` key is inference-only. See PLAN D8/D9. |
| Antigravity (AGY) | Fragile-feasible | Local language-server integration; loopback `GetUserStatus`; stale cache when closed. |
| Xiaomi MiMo Token Plan Lite | Backlog optional | Known dashboard endpoints: `/tokenPlan/detail`, `/tokenPlan/usage`. Need sanitized response shapes, reset semantics, and `tp-…` key authorization test. |
| DeepSeek API balance | Solid optional | Official `/user/balance`; balance tracking only, not exact usage/spend. |

