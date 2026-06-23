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

type DeepSeekKeySlot = {
  id: number;
  has_key: boolean;
};

const placeholders = ["OpenCode Go", "Antigravity"];

function App() {
  const [apiKey, setApiKey] = useState("");
  const [keySlots, setKeySlots] = useState<DeepSeekKeySlot[]>([]);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [claudeSnapshot, setClaudeSnapshot] = useState<ProviderSnapshot | null>(null);
  const [codexSnapshot, setCodexSnapshot] = useState<ProviderSnapshot | null>(null);
  const [deepseekSnapshot, setDeepseekSnapshot] = useState<ProviderSnapshot | null>(null);
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
  }, []);

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
      setStatus("Updated");
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
        </div>

        {placeholders.map((provider) => (
          <div className="provider-row" key={provider}>
            <span>{provider}</span>
            <span className="muted">Not connected</span>
          </div>
        ))}
      </section>

      <footer>{error || "No spend history stored yet."}</footer>
    </main>
  );
}

export default App;
