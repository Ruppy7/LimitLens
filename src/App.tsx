import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type MetricLine = {
  label: string;
  value: string;
};

type ProviderSnapshot = {
  provider_id: string;
  lines: MetricLine[];
};

type SavedSnapshot = {
  provider_id: string;
  captured_at: number;
  snapshot: ProviderSnapshot;
};

type DeepSeekKeySlot = {
  id: number;
  has_key: boolean;
};

const placeholders = ["Antigravity"];
type OpenCodeView = "spend" | "quota";
const opencodeSpendLabels = new Set(["Last 7 days", "Last 30 days", "Tokens (30d)", "All-time"]);

function App() {
  const [apiKey, setApiKey] = useState("");
  const [keySlots, setKeySlots] = useState<DeepSeekKeySlot[]>([]);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [claudeSnapshot, setClaudeSnapshot] = useState<ProviderSnapshot | null>(null);
  const [codexSnapshot, setCodexSnapshot] = useState<ProviderSnapshot | null>(null);
  const [deepseekSnapshot, setDeepseekSnapshot] = useState<ProviderSnapshot | null>(null);
  const [opencodeSnapshot, setOpencodeSnapshot] = useState<ProviderSnapshot | null>(null);
  const [opencodeQuotaConnected, setOpencodeQuotaConnected] = useState(false);
  const [showOpencodeQuotaSetup, setShowOpencodeQuotaSetup] = useState(false);
  const [opencodeCookie, setOpencodeCookie] = useState("");
  const [opencodeWorkspace, setOpencodeWorkspace] = useState("");
  const [opencodeView, setOpencodeView] = useState<OpenCodeView>("spend");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Record<string, number>>({});
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");

  const savedKeyCount = useMemo(
    () => keySlots.filter((slot) => slot.has_key).length,
    [keySlots],
  );
  const hasKey = savedKeyCount > 0;
  const canAddKey = savedKeyCount === 0;

  useEffect(() => {
    invoke<DeepSeekKeySlot[]>("list_deepseek_api_keys")
      .then((slots) => {
        setKeySlots(slots);
        setIsAddingKey(slots.every((slot) => !slot.has_key));
      })
      .catch(() => setKeySlots([]));

    invoke<SavedSnapshot[]>("list_saved_snapshots")
      .then((savedSnapshots) => {
        const updatedAt: Record<string, number> = {};

        for (const saved of savedSnapshots) {
          updatedAt[saved.provider_id] = saved.captured_at;

          if (saved.provider_id === "claude") {
            setClaudeSnapshot(saved.snapshot);
          } else if (saved.provider_id === "codex") {
            setCodexSnapshot(saved.snapshot);
          } else if (saved.provider_id === "deepseek") {
            setDeepseekSnapshot(saved.snapshot);
          } else if (saved.provider_id === "opencode") {
            setOpencodeSnapshot(saved.snapshot);
          }
        }

        setLastUpdatedAt(updatedAt);
      })
      .catch(() => {});

    invoke<boolean>("opencode_quota_session_status")
      .then(setOpencodeQuotaConnected)
      .catch(() => setOpencodeQuotaConnected(false));
  }, []);

  function markUpdated(snapshot: ProviderSnapshot, capturedAt = Math.floor(Date.now() / 1000)) {
    setLastUpdatedAt((current) => ({
      ...current,
      [snapshot.provider_id]: capturedAt,
    }));
  }

  function updatedLabel(providerId: string) {
    const capturedAt = lastUpdatedAt[providerId];

    if (!capturedAt) {
      return "";
    }

    const date = new Date(capturedAt * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");

    return `Updated ${pad(date.getDate())}-${pad(date.getMonth() + 1)} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  async function saveKey() {
    setError("");
    setStatus("Saving");
    try {
      const slots = await invoke<DeepSeekKeySlot[]>("save_deepseek_api_key", { apiKey });
      setApiKey("");
      setKeySlots(slots);
      setIsAddingKey(false);
      setStatus("Saved");
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  async function deleteKey(slot: number) {
    setError("");
    setStatus("Deleting");
    try {
      const slots = await invoke<DeepSeekKeySlot[]>("delete_deepseek_api_key", { slot });
      setKeySlots(slots);
      setDeepseekSnapshot(null);
      setIsAddingKey(slots.every((nextSlot) => !nextSlot.has_key));
      setStatus("Deleted");
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  async function refreshDeepSeek() {
    setError("");
    setStatus("Refreshing");
    try {
      const nextSnapshot = await invoke<ProviderSnapshot>("refresh_deepseek");
      setDeepseekSnapshot(nextSnapshot);
      markUpdated(nextSnapshot);
      setStatus("Updated");
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  async function refreshCodex() {
    setError("");
    setStatus("Refreshing");
    try {
      const nextSnapshot = await invoke<ProviderSnapshot>("refresh_codex");
      setCodexSnapshot(nextSnapshot);
      markUpdated(nextSnapshot);
      setStatus("Updated");
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  async function refreshClaude() {
    setError("");
    setStatus("Refreshing");
    try {
      const nextSnapshot = await invoke<ProviderSnapshot>("refresh_claude");
      setClaudeSnapshot(nextSnapshot);
      markUpdated(nextSnapshot);
      setStatus("Updated");
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  async function refreshOpenCode() {
    setError("");
    setStatus("Refreshing");
    try {
      const nextSnapshot = await invoke<ProviderSnapshot>("refresh_opencode");
      setOpencodeSnapshot(nextSnapshot);
      markUpdated(nextSnapshot);
      setStatus("Updated");
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  async function saveOpenCodeQuota() {
    setError("");
    setStatus("Saving quota");
    try {
      const nextSnapshot = await invoke<ProviderSnapshot>("save_opencode_quota_session", {
        cookie: opencodeCookie,
        workspace: opencodeWorkspace,
      });
      setOpencodeCookie("");
      setOpencodeWorkspace("");
      setShowOpencodeQuotaSetup(false);
      setOpencodeQuotaConnected(true);
      setOpencodeView("quota");
      setOpencodeSnapshot(nextSnapshot);
      markUpdated(nextSnapshot);
      setStatus("Updated");
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  async function disconnectOpenCodeQuota() {
    setError("");
    setStatus("Disconnecting");
    try {
      const connected = await invoke<boolean>("disconnect_opencode_quota");
      setOpencodeQuotaConnected(connected);
      setOpencodeView("spend");
      setShowOpencodeQuotaSetup(false);
      setStatus("Disconnected");
      await refreshOpenCode();
    } catch (caught) {
      setStatus("Error");
      setError(String(caught));
    }
  }

  return (
    <main className="panel">
      <header className="panel-header">
        <div>
          <h1>InfUsage</h1>
          <p>AI usage from the Windows tray</p>
        </div>
        <span className="status">{status}</span>
      </header>

      <section className="provider-list" aria-label="Providers">
        <div className="provider-block">
          <div className="provider-row">
            <span>Codex</span>
            <span className={codexSnapshot ? "ok" : "muted"}>
              {codexSnapshot ? "Updated" : "Uses local login"}
            </span>
          </div>

          <div className="deepseek-actions">
            <button onClick={refreshCodex} type="button">
              Refresh
            </button>
          </div>

          {codexSnapshot?.lines.map((line) => (
            <div className="metric-row" key={line.label}>
              <span>{line.label}</span>
              <strong>{line.value}</strong>
            </div>
          ))}
          {codexSnapshot && <p className="updated-at">{updatedLabel("codex")}</p>}
        </div>

        <div className="provider-block">
          <div className="provider-row">
            <span>Claude / Claude Code</span>
            <span className={claudeSnapshot ? "ok" : "muted"}>
              {claudeSnapshot ? "Updated" : "Uses local login"}
            </span>
          </div>

          <div className="deepseek-actions">
            <button onClick={refreshClaude} type="button">
              Refresh
            </button>
          </div>

          {claudeSnapshot?.lines.map((line) => (
            <div className="metric-row" key={line.label}>
              <span>{line.label}</span>
              <strong>{line.value}</strong>
            </div>
          ))}
          {claudeSnapshot && <p className="updated-at">{updatedLabel("claude")}</p>}
        </div>

        <div className="provider-block">
          <div className="provider-row">
            <span>DeepSeek</span>
            <span className={hasKey ? "ok" : "muted"}>
              {hasKey ? "Connected" : "Not connected"}
            </span>
          </div>

          {hasKey && (
            <div className="key-list">
              {keySlots
                .filter((slot) => slot.has_key)
                .map((slot) => (
                  <div className="key-row" key={slot.id}>
                    <span>API key saved</span>
                    <button onClick={() => deleteKey(slot.id)} type="button">
                      Delete
                    </button>
                  </div>
                ))}
            </div>
          )}

          {isAddingKey && canAddKey && (
            <div className="deepseek-controls">
              <input
                aria-label="DeepSeek API key"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="DeepSeek API key"
                type="password"
                value={apiKey}
              />
              <button disabled={!apiKey.trim()} onClick={saveKey} type="button">
                Save
              </button>
              {hasKey && (
                <button onClick={() => setIsAddingKey(false)} type="button">
                  Cancel
                </button>
              )}
            </div>
          )}

          <div className="deepseek-actions">
            {!isAddingKey && canAddKey && (
              <button onClick={() => setIsAddingKey(true)} type="button">
                Add key
              </button>
            )}
            <button disabled={!hasKey} onClick={refreshDeepSeek} type="button">
              Refresh
            </button>
          </div>

          {deepseekSnapshot?.lines.map((line) => (
            <div className="metric-row" key={line.label}>
              <span>{line.label}</span>
              <strong>{line.value}</strong>
            </div>
          ))}
          {deepseekSnapshot && <p className="updated-at">{updatedLabel("deepseek")}</p>}
        </div>

        <div className="provider-block">
          <div className="provider-row">
            <span>OpenCode Go</span>
            <span className={opencodeSnapshot ? "ok" : "muted"}>
              {opencodeQuotaConnected
                ? opencodeView === "quota"
                  ? "Quota"
                  : "Spend"
                : opencodeSnapshot
                  ? "Updated"
                  : "Local spend"}
            </span>
          </div>

          <div className="deepseek-actions">
            <button onClick={refreshOpenCode} type="button">
              Refresh
            </button>
            {opencodeQuotaConnected && (
              <>
                <button
                  disabled={opencodeView === "spend"}
                  onClick={() => setOpencodeView("spend")}
                  type="button"
                >
                  Spend
                </button>
                <button
                  disabled={opencodeView === "quota"}
                  onClick={() => setOpencodeView("quota")}
                  type="button"
                >
                  Quota
                </button>
              </>
            )}
            {opencodeQuotaConnected ? (
              <button onClick={disconnectOpenCodeQuota} type="button">
                Disconnect quota
              </button>
            ) : (
              <button onClick={() => setShowOpencodeQuotaSetup((current) => !current)} type="button">
                Dev quota
              </button>
            )}
          </div>

          {showOpencodeQuotaSetup && !opencodeQuotaConnected && (
            <div className="deepseek-controls">
              <input
                aria-label="OpenCode workspace URL"
                onChange={(event) => setOpencodeWorkspace(event.target.value)}
                placeholder="Workspace URL or wrk_ id"
                type="text"
                value={opencodeWorkspace}
              />
              <input
                aria-label="OpenCode cookie header"
                onChange={(event) => setOpencodeCookie(event.target.value)}
                placeholder="Cookie header"
                type="password"
                value={opencodeCookie}
              />
              <button
                disabled={!opencodeCookie.trim() || !opencodeWorkspace.trim()}
                onClick={saveOpenCodeQuota}
                type="button"
              >
                Save
              </button>
            </div>
          )}

          {opencodeSnapshot?.lines
            .filter((line) =>
              opencodeView === "spend"
                ? opencodeSpendLabels.has(line.label)
                : !opencodeSpendLabels.has(line.label),
            )
            .map((line) => (
              <div className="metric-row" key={line.label}>
                <span>{line.label}</span>
                <strong>{line.value}</strong>
              </div>
            ))}
          {opencodeSnapshot && <p className="updated-at">{updatedLabel("opencode")}</p>}
        </div>

        {placeholders.map((provider) => (
          <div className="provider-row" key={provider}>
            <span>{provider}</span>
            <span className="muted">Not connected</span>
          </div>
        ))}
      </section>

      <footer>{error || "Latest snapshots are stored locally."}</footer>
    </main>
  );
}

export default App;
