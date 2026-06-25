import { type PointerEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Minus,
  Pin,
  PinOff,
  PlugZap,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Unplug,
} from "lucide-react";
import "./App.css";
import anthropicIcon from "./assets/providers/anthropic.svg";
import deepseekIcon from "./assets/providers/deepseek.svg";
import openaiIcon from "./assets/providers/openai.svg";
import opencodeIcon from "./assets/providers/opencode.svg";

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

type DisplayMode = "minimal" | "all";
type ThemeMode = "system" | "light" | "dark";
type ProviderKey = "codex" | "claude" | "deepseek" | "opencode";
type LifecycleState = "refreshing" | "fresh" | "stale" | "error" | "empty";
type DisconnectedProviders = Partial<Record<ProviderKey, boolean>>;

const STALE_AFTER_SECONDS = 15 * 60;
const DEFAULT_REFRESH_INTERVAL_MINUTES = 15;
const MIN_REFRESH_INTERVAL_MINUTES = 5;
const MAX_REFRESH_INTERVAL_MINUTES = 120;
const archivedOpenCodeSpendLabels = new Set(["Last 7 days", "Last 30 days", "Tokens (30d)", "All-time"]);

type ProviderMeta = {
  id: ProviderKey;
  title: string;
  icon: string;
  note: string;
  emptyLabel: string;
};

const PROVIDERS: ProviderMeta[] = [
  { id: "codex", title: "Codex", icon: openaiIcon, note: "Authorizes via your local Codex login (~/.codex/auth.json). No key to manage.", emptyLabel: "Local login needed" },
  { id: "claude", title: "Claude", icon: anthropicIcon, note: "Authorizes via your local Claude Code login (~/.claude/.credentials.json). Limits apply across Claude products.", emptyLabel: "Local login needed" },
  { id: "deepseek", title: "DeepSeek", icon: deepseekIcon, note: "Add an API key to read your balance from the official /user/balance endpoint.", emptyLabel: "No API key" },
  { id: "opencode", title: "OpenCode Go", icon: opencodeIcon, note: "Links an OpenCode console session to show Go limits. Local device DB spend is archived as optional project code.", emptyLabel: "Go limits not linked" },
];

const LOCAL_LOGIN_PROVIDERS: ProviderKey[] = ["codex", "claude"];

function readDisplayMode() {
  const value = readPersisted("infusage.displayMode", "minimal");
  return value === "all" || value === "minimal" ? value : "minimal";
}

function readProviderKey() {
  const value = readPersisted("infusage.selectedProvider", "codex");
  return PROVIDERS.some((provider) => provider.id === value) ? (value as ProviderKey) : "codex";
}

function readThemeMode() {
  const value = readPersisted("infusage.themeMode", "system");
  return value === "system" || value === "light" || value === "dark" ? value : "system";
}

function readPoppedOut() {
  return readPersisted("infusage.poppedOut", "false") === "true";
}

function readRefreshEnabled() {
  return readPersisted("infusage.refreshEnabled", "false") === "true";
}

function readRefreshIntervalMinutes() {
  const value = Number(readPersisted("infusage.refreshIntervalMinutes", String(DEFAULT_REFRESH_INTERVAL_MINUTES)));
  if (!Number.isFinite(value)) return DEFAULT_REFRESH_INTERVAL_MINUTES;
  return Math.min(MAX_REFRESH_INTERVAL_MINUTES, Math.max(MIN_REFRESH_INTERVAL_MINUTES, Math.round(value)));
}

function readDisconnectedProviders(): DisconnectedProviders {
  const value = readPersisted("infusage.disconnectedProviders", "{}");
  try {
    const parsed = JSON.parse(value) as DisconnectedProviders;
    return PROVIDERS.reduce<DisconnectedProviders>((next, provider) => {
      if (parsed[provider.id] === true) next[provider.id] = true;
      return next;
    }, {});
  } catch {
    return {};
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage is best-effort; if unavailable we degrade gracefully.
  }
}

function readPersisted(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function relativeAge(epochSeconds: number | undefined): string {
  if (!epochSeconds) return "Not synced";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  const date = new Date(epochSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" />
      <rect x="6" y="12" width="3" height="6" rx="1.4" />
      <rect x="10.5" y="8" width="3" height="10" rx="1.4" />
      <circle cx="17" cy="7" r="2" />
    </svg>
  );
}

function App() {
  const [snapshots, setSnapshots] = useState<Record<ProviderKey, ProviderSnapshot | null>>({
    codex: null,
    claude: null,
    deepseek: null,
    opencode: null,
  });
  const [refreshing, setRefreshing] = useState<Record<ProviderKey, boolean>>({
    codex: false,
    claude: false,
    deepseek: false,
    opencode: false,
  });
  const [errors, setErrors] = useState<Record<ProviderKey, string | null>>({
    codex: null,
    claude: null,
    deepseek: null,
    opencode: null,
  });
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Record<ProviderKey, number>>({
    codex: 0,
    claude: 0,
    deepseek: 0,
    opencode: 0,
  });

  const [keySlots, setKeySlots] = useState<DeepSeekKeySlot[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [isAddingKey, setIsAddingKey] = useState(false);

  const [opencodeQuotaConnected, setOpencodeQuotaConnected] = useState(false);
  const [opencodeCookie, setOpencodeCookie] = useState("");
  const [opencodeWorkspace, setOpencodeWorkspace] = useState("");

  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(
    readDisplayMode,
  );
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey>(
    readProviderKey,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [poppedOut, setPoppedOut] = useState(readPoppedOut);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [refreshEnabled, setRefreshEnabled] = useState(readRefreshEnabled);
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(readRefreshIntervalMinutes);
  const [disconnectedProviders, setDisconnectedProviders] = useState<DisconnectedProviders>(readDisconnectedProviders);

  const savedKeyCount = useMemo(() => keySlots.filter((slot) => slot.has_key).length, [keySlots]);
  const savedKeySlot = useMemo(() => keySlots.find((slot) => slot.has_key), [keySlots]);
  const hasKey = savedKeyCount > 0;

  const anyRefreshing = useMemo(() => Object.values(refreshing).some(Boolean), [refreshing]);

  useEffect(() => {
    invoke<DeepSeekKeySlot[]>("list_deepseek_api_keys")
      .then((slots) => {
        setKeySlots(slots);
        setIsAddingKey(slots.every((slot) => !slot.has_key));
      })
      .catch(() => setKeySlots([]));

    invoke<SavedSnapshot[]>("list_saved_snapshots")
      .then((savedSnapshots) => {
        const next: Record<ProviderKey, ProviderSnapshot | null> = { codex: null, claude: null, deepseek: null, opencode: null };
        const nextUpdated: Record<ProviderKey, number> = { codex: 0, claude: 0, deepseek: 0, opencode: 0 };

        for (const saved of savedSnapshots) {
          const providerId = saved.provider_id as ProviderKey;
          if (providerId in next) {
            next[providerId] = saved.snapshot;
            nextUpdated[providerId] = saved.captured_at;
          }
        }

        setSnapshots(next);
        setLastUpdatedAt(nextUpdated);
      })
      .catch(() => {});

    invoke<boolean>("opencode_quota_session_status")
      .then(setOpencodeQuotaConnected)
      .catch(() => setOpencodeQuotaConnected(false));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let openTimeout: number | undefined;
    let closeTimeout: number | undefined;
    const unlistenPromise = listen("tray-popup-opened", () => {
      setClosing(false);
      setOpening(true);
      openTimeout = window.setTimeout(() => setOpening(false), 240);
    });
    const unlistenClosingPromise = listen("tray-popup-closing", () => {
      setOpening(false);
      setClosing(true);
      closeTimeout = window.setTimeout(() => {
        invoke("hide_tray_window").catch(() => {});
        setClosing(false);
      }, 180);
    });

    return () => {
      if (openTimeout) window.clearTimeout(openTimeout);
      if (closeTimeout) window.clearTimeout(closeTimeout);
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      unlistenClosingPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    persist("infusage.displayMode", displayMode);
  }, [displayMode]);

  useEffect(() => {
    invoke("set_tray_display_mode", { mode: settingsOpen ? "all" : displayMode }).catch(() => {});
  }, [displayMode, settingsOpen]);

  useEffect(() => {
    persist("infusage.selectedProvider", selectedProvider);
  }, [selectedProvider]);

  useEffect(() => {
    persist("infusage.themeMode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    persist("infusage.poppedOut", String(poppedOut));
    invoke("set_tray_popped_out", { poppedOut }).catch(() => {});
  }, [poppedOut]);

  useEffect(() => {
    persist("infusage.disconnectedProviders", JSON.stringify(disconnectedProviders));
  }, [disconnectedProviders]);

  useEffect(() => {
    persist("infusage.refreshIntervalMinutes", String(refreshIntervalMinutes));
  }, [refreshIntervalMinutes]);

  useEffect(() => {
    persist("infusage.refreshEnabled", String(refreshEnabled));
  }, [refreshEnabled]);

  useEffect(() => {
    if (!refreshEnabled) return;
    const interval = window.setInterval(() => {
      void refreshAllConnected();
    }, refreshIntervalMinutes * 60_000);
    return () => window.clearInterval(interval);
  }, [refreshEnabled, refreshIntervalMinutes, disconnectedProviders, hasKey, opencodeQuotaConnected, refreshing]);

  function setRefreshingFor(key: ProviderKey, value: boolean) {
    setRefreshing((current) => ({ ...current, [key]: value }));
  }

  function setProviderError(key: ProviderKey, message: string | null) {
    setErrors((current) => ({ ...current, [key]: message }));
  }

  async function runRefresh(key: ProviderKey, fn: () => Promise<ProviderSnapshot>) {
    setRefreshingFor(key, true);
    setProviderError(key, null);
    try {
      const snapshot = await fn();
      setSnapshots((current) => ({ ...current, [key]: snapshot }));
      setLastUpdatedAt((current) => ({ ...current, [key]: Math.floor(Date.now() / 1000) }));
    } catch (caught) {
      setProviderError(key, String(caught));
    } finally {
      setRefreshingFor(key, false);
    }
  }

  async function refreshCodex() {
    await runRefresh("codex", () => invoke<ProviderSnapshot>("refresh_codex"));
  }
  async function refreshClaude() {
    await runRefresh("claude", () => invoke<ProviderSnapshot>("refresh_claude"));
  }
  async function refreshDeepSeek() {
    await runRefresh("deepseek", () => invoke<ProviderSnapshot>("refresh_deepseek"));
  }
  async function refreshOpenCode() {
    await runRefresh("opencode", () => invoke<ProviderSnapshot>("refresh_opencode"));
  }

  async function refreshAllConnected() {
    if (Object.values(refreshing).some(Boolean)) return;
    const tasks: Promise<void>[] = [];
    if (!disconnectedProviders.codex) tasks.push(refreshCodex());
    if (!disconnectedProviders.claude) tasks.push(refreshClaude());
    if (!disconnectedProviders.deepseek && hasKey) tasks.push(refreshDeepSeek());
    if (!disconnectedProviders.opencode && opencodeQuotaConnected) tasks.push(refreshOpenCode());
    await Promise.allSettled(tasks);
  }

  function chooseDisplayMode(mode: DisplayMode) {
    setDisplayMode(mode);
    setSettingsOpen(false);
  }

  function chooseRefreshInterval(value: number) {
    if (!Number.isFinite(value)) return;
    setRefreshIntervalMinutes(Math.min(MAX_REFRESH_INTERVAL_MINUTES, Math.max(MIN_REFRESH_INTERVAL_MINUTES, Math.round(value))));
  }

  async function saveKey() {
    setProviderError("deepseek", null);
    try {
      if (savedKeySlot) {
        await invoke<DeepSeekKeySlot[]>("delete_deepseek_api_key", { slot: savedKeySlot.id });
      }
      const slots = await invoke<DeepSeekKeySlot[]>("save_deepseek_api_key", { apiKey });
      setApiKey("");
      setKeySlots(slots);
      setIsAddingKey(false);
      await refreshDeepSeek();
    } catch (caught) {
      setProviderError("deepseek", String(caught));
    }
  }

  async function deleteSavedKey() {
    if (savedKeySlot) {
      await deleteKey(savedKeySlot.id);
    }
  }

  function beginKeyReplace() {
    setApiKey("");
    setIsAddingKey(true);
  }

  function cancelKeyReplace() {
    setApiKey("");
    setIsAddingKey(false);
  }

  async function deleteKey(slot: number) {
    setProviderError("deepseek", null);
    try {
      const slots = await invoke<DeepSeekKeySlot[]>("delete_deepseek_api_key", { slot });
      setKeySlots(slots);
      setSnapshots((current) => ({ ...current, deepseek: null }));
      setLastUpdatedAt((current) => ({ ...current, deepseek: 0 }));
      setIsAddingKey(slots.every((nextSlot) => !nextSlot.has_key));
    } catch (caught) {
      setProviderError("deepseek", String(caught));
    }
  }

  async function connectQuota() {
    setProviderError("opencode", null);
    await runRefresh("opencode", async () => {
      const snapshot = await invoke<ProviderSnapshot>("save_opencode_quota_session", {
        cookie: opencodeCookie,
        workspace: opencodeWorkspace,
      });
      setOpencodeCookie("");
      setOpencodeWorkspace("");
      setOpencodeQuotaConnected(true);
      return snapshot;
    });
  }

  async function disconnectQuota() {
    setProviderError("opencode", null);
    try {
      const connected = await invoke<boolean>("disconnect_opencode_quota");
      setOpencodeQuotaConnected(connected);
      setSnapshots((current) => ({ ...current, opencode: null }));
      setLastUpdatedAt((current) => ({ ...current, opencode: 0 }));
    } catch (caught) {
      setProviderError("opencode", String(caught));
    }
  }

  function deriveState(key: ProviderKey): LifecycleState {
    if (disconnectedProviders[key]) return "empty";
    if (refreshing[key]) return "refreshing";
    if (errors[key]) return "error";
    if (key === "opencode" && !opencodeQuotaConnected) return "empty";
    const snapshot = snapshots[key];
    const updated = lastUpdatedAt[key];
    if (!snapshot && !updated) return "empty";
    if (updated && nowSeconds - updated >= STALE_AFTER_SECONDS) return "stale";
    return "fresh";
  }

  function authConnected(key: ProviderKey): boolean {
    if (disconnectedProviders[key]) return false;
    if (key === "deepseek") return hasKey;
    if (key === "opencode") return opencodeQuotaConnected;
    return snapshots[key] !== null;
  }

  function lifecycleLabel(key: ProviderKey): string {
    if (disconnectedProviders[key]) return "Disconnected";
    const state = deriveState(key);
    switch (state) {
      case "refreshing":
        return "Syncing";
      case "fresh":
        return "Fresh";
      case "stale":
        return "Stale";
      case "error":
        return "Error";
      case "empty":
        return PROVIDERS.find((provider) => provider.id === key)?.emptyLabel ?? "Not connected";
    }
  }

  function startWindowDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button,input")) {
      return;
    }
    void getCurrentWindow().startDragging();
  }

  function hideTray() {
    invoke("request_tray_close").catch(() => invoke("hide_tray_window").catch(() => {}));
  }

  function disconnectProvider(key: ProviderKey) {
    setDisconnectedProviders((current) => ({ ...current, [key]: true }));
    setSnapshots((current) => ({ ...current, [key]: null }));
    setLastUpdatedAt((current) => ({ ...current, [key]: 0 }));
    setProviderError(key, null);
  }

  async function reconnectProvider(key: ProviderKey) {
    setDisconnectedProviders((current) => ({ ...current, [key]: false }));
    if (key === "codex") await refreshCodex();
    if (key === "claude") await refreshClaude();
  }

  function cardFor(key: ProviderKey): ReactNode {
    const meta = PROVIDERS.find((provider) => provider.id === key)!;
    const snapshotLines = snapshots[key]?.lines ?? [];
    const providerUnavailable = disconnectedProviders[key] || (key === "opencode" && !opencodeQuotaConnected);
    const rawMetrics =
      providerUnavailable ? [] : key === "opencode" ? snapshotLines.filter((line) => !archivedOpenCodeSpendLabels.has(line.label)) : snapshotLines;
    const planLabel = key === "codex" || key === "claude" ? rawMetrics.find((line) => line.label === "Plan")?.value : undefined;
    const metrics = planLabel ? rawMetrics.filter((line) => line.label !== "Plan") : rawMetrics;
    const state = deriveState(key);
    const errorMessage = errors[key];
    const retry =
      key === "codex" ? refreshCodex : key === "claude" ? refreshClaude : key === "deepseek" ? refreshDeepSeek : refreshOpenCode;

    let hint: string | null = null;
    if (state === "empty") {
      if (disconnectedProviders[key]) hint = "Enable in Settings";
      else if (key === "deepseek" && !hasKey) hint = "Add an API key in Settings";
      else if (key === "opencode" && !opencodeQuotaConnected) hint = "Link dev quota in Settings";
    }

    return (
      <ProviderCard
        icon={meta.icon}
        title={meta.title}
        planLabel={planLabel}
        state={state}
        stateLabel={lifecycleLabel(key)}
        authConnected={authConnected(key)}
        ageLabel={relativeAge(lastUpdatedAt[key] || undefined)}
        metrics={metrics}
        errorMessage={errorMessage}
        onRefresh={retry}
        emptyHint={hint}
      />
    );
  }

  return (
    <main
      className={`${displayMode === "minimal" ? "panel minimal" : "panel"}${opening ? " opening" : ""}${closing ? " closing" : ""}`}
      data-theme={themeMode}
      data-floating={poppedOut}
      onPointerDown={poppedOut ? startWindowDrag : undefined}
    >
      <header className="panel-header">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <h1>InfUsage</h1>
            <p>Inference usage</p>
          </div>
        </div>
        <div className="header-actions">
          <span className={anyRefreshing ? "header-spinner" : "header-spinner idle"} aria-label="Syncing" aria-hidden={!anyRefreshing}>
            <Loader2 aria-hidden="true" size={15} />
          </span>
          <button
            aria-label="Refresh connected providers"
            className="icon-button"
            disabled={anyRefreshing}
            onClick={() => void refreshAllConnected()}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
          </button>
          <button
            aria-label={settingsOpen ? "Close settings" : "Settings"}
            aria-expanded={settingsOpen}
            className="icon-button"
            onClick={() => setSettingsOpen((current) => !current)}
            type="button"
          >
            {settingsOpen ? <ArrowLeft aria-hidden="true" size={15} /> : <Settings aria-hidden="true" size={15} />}
          </button>
          <button
            aria-label={poppedOut ? "Floating window - attach to tray" : "Attached to tray - pop out"}
            aria-pressed={poppedOut}
            className="icon-button pin-button"
            onClick={() => setPoppedOut((current) => !current)}
            title={poppedOut ? "Floating window" : "Attached to tray"}
            type="button"
          >
            {poppedOut ? <PinOff aria-hidden="true" size={15} /> : <Pin aria-hidden="true" size={15} />}
          </button>
          <button aria-label="Hide window" className="icon-button" onClick={hideTray} type="button">
            <Minus aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsSheet
          displayMode={displayMode}
          themeMode={themeMode}
          disconnectedProviders={disconnectedProviders}
          onChooseDisplayMode={chooseDisplayMode}
          onChooseThemeMode={setThemeMode}
          hasKey={hasKey}
          isAddingKey={isAddingKey}
          apiKey={apiKey}
          opencodeQuotaConnected={opencodeQuotaConnected}
          refreshEnabled={refreshEnabled}
          refreshIntervalMinutes={refreshIntervalMinutes}
          opencodeCookie={opencodeCookie}
          opencodeWorkspace={opencodeWorkspace}
          onApiKeyChange={setApiKey}
          onSaveKey={saveKey}
          onDeleteKey={deleteSavedKey}
          onBeginAddKey={beginKeyReplace}
          onCancelAddKey={cancelKeyReplace}
          onConnectQuota={connectQuota}
          onDisconnectQuota={disconnectQuota}
          onRefreshEnabledChange={setRefreshEnabled}
          onRefreshIntervalChange={chooseRefreshInterval}
          onWorkspaceChange={setOpencodeWorkspace}
          onCookieChange={setOpencodeCookie}
          onDisconnectProvider={disconnectProvider}
          onReconnectProvider={reconnectProvider}
        />
      ) : (
        <section className={displayMode === "minimal" ? "provider-browser" : "provider-browser all"} aria-label="Providers">
          {displayMode === "minimal" && (
            <nav className="provider-rail" aria-label="Pick provider">
              {PROVIDERS.map((provider) => (
                <button
                  aria-label={provider.title}
                  aria-pressed={selectedProvider === provider.id}
                  className="rail-item"
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  type="button"
                >
                  <span className="rail-mark">
                    <img alt="" src={provider.icon} />
                  </span>
                  <span className={authConnected(provider.id) ? "rail-dot on" : "rail-dot"} />
                </button>
              ))}
            </nav>
          )}

          <div className="provider-list" key={displayMode === "minimal" ? selectedProvider : "all"}>
            {displayMode === "minimal"
              ? cardFor(selectedProvider)
              : PROVIDERS.map((provider) => (
                  <section aria-label={provider.title} className="card-slot" key={provider.id}>
                    {cardFor(provider.id)}
                  </section>
                ))}
          </div>
        </section>
      )}

      {!settingsOpen && displayMode === "all" && (
        <footer className="panel-foot">
          {Object.values(snapshots).every((snapshot) => snapshot === null)
            ? "No data yet - open Settings to connect providers."
            : "Snapshots are stored locally."}
        </footer>
      )}
    </main>
  );
}

type ProviderCardProps = {
  icon: string;
  title: string;
  planLabel?: string;
  state: LifecycleState;
  stateLabel: string;
  authConnected: boolean;
  ageLabel: string;
  metrics: MetricLine[];
  errorMessage: string | null;
  onRefresh: () => void;
  emptyHint?: string | null;
};

function ProviderCard({
  icon,
  title,
  planLabel,
  state,
  stateLabel,
  authConnected,
  ageLabel,
  metrics,
  errorMessage,
  onRefresh,
  emptyHint,
}: ProviderCardProps) {
  return (
    <section aria-label={title} className={`provider-card state-${state}`}>
      <div className="provider-heading">
        <div className="provider-title">
          <span className="provider-mark">
            <img alt="" src={icon} />
          </span>
          <span className="provider-name">{title}</span>
          {planLabel && <span className="provider-plan">{planLabel}</span>}
          <span className={authConnected ? "auth-dot on" : "auth-dot"} aria-hidden="true" />
        </div>
        <div className="heading-tools">
          <span className="lifecycle-chip" aria-label={`Status: ${stateLabel}`}>
            {state === "refreshing" && <Loader2 aria-hidden="true" size={11} className="spin" />}
            {state === "fresh" && <Check aria-hidden="true" size={11} />}
            {state === "stale" && <AlertTriangle aria-hidden="true" size={11} />}
            {state === "error" && <AlertTriangle aria-hidden="true" size={11} />}
            {stateLabel}
          </span>
          <button
            aria-label={`Refresh ${title}`}
            className="icon-button"
            disabled={state === "refreshing"}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={14} />
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="card-error">
          <AlertTriangle aria-hidden="true" size={12} />
          <span>{errorMessage}</span>
          <button className="retry-btn" onClick={onRefresh} type="button">
            Retry
          </button>
        </div>
      )}

      {metrics.length > 0 && (
        <div className="metric-list">
          {metrics.map((line) => (
            <MetricRow key={line.label} line={line} />
          ))}
        </div>
      )}

      {state === "empty" && emptyHint && <div className="card-hint">{emptyHint}</div>}

      <div className="provider-foot">
        {state === "empty" ? (
          <span>Not synced yet</span>
        ) : (
          <span aria-label={`Last refreshed ${ageLabel}`}>Updated {ageLabel}</span>
        )}
      </div>
    </section>
  );
}

function MetricRow({ line }: { line: MetricLine }) {
  const metric = metricParts(line);
  return (
    <div className="metric-row">
      <div className="metric-copy">
        <div className="metric-label">
          <span>{metric.label}</span>
          {metric.resetText && <em>- {metric.resetText}</em>}
        </div>
        {metric.percentText ? <strong>{metric.percentText}</strong> : <strong>{metric.value}</strong>}
      </div>
      {metric.percent !== null && (
        <div
          aria-label={metric.label}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(metric.percent)}
          className="metric-progress"
          role="progressbar"
        >
          <span aria-hidden="true" style={{ width: `${metric.percent}%` }} />
        </div>
      )}
    </div>
  );
}

type IconButtonProps = {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

function IconOnlyButton({ disabled = false, icon, label, onClick }: IconButtonProps) {
  return (
    <button aria-label={label} className="icon-only-button" disabled={disabled} onClick={onClick} title={label} type="button">
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

type SettingsSheetProps = {
  displayMode: DisplayMode;
  themeMode: ThemeMode;
  disconnectedProviders: DisconnectedProviders;
  onChooseDisplayMode: (mode: DisplayMode) => void;
  onChooseThemeMode: (mode: ThemeMode) => void;
  hasKey: boolean;
  isAddingKey: boolean;
  apiKey: string;
  opencodeQuotaConnected: boolean;
  refreshEnabled: boolean;
  refreshIntervalMinutes: number;
  opencodeCookie: string;
  opencodeWorkspace: string;
  onApiKeyChange: (value: string) => void;
  onSaveKey: () => void;
  onDeleteKey: () => void;
  onBeginAddKey: () => void;
  onCancelAddKey: () => void;
  onConnectQuota: () => void;
  onDisconnectQuota: () => void;
  onRefreshEnabledChange: (value: boolean) => void;
  onRefreshIntervalChange: (value: number) => void;
  onWorkspaceChange: (value: string) => void;
  onCookieChange: (value: string) => void;
  onDisconnectProvider: (key: ProviderKey) => void;
  onReconnectProvider: (key: ProviderKey) => void;
};

function SettingsSheet(props: SettingsSheetProps) {
  return (
    <section className="settings-sheet" aria-label="Settings">
      <div className="settings-body">
        <SettingsSection title="Display">
          <div className="seg" aria-label="Display mode" role="group">
            <button aria-pressed={props.displayMode === "minimal"} onClick={() => props.onChooseDisplayMode("minimal")} type="button">
              Focus
            </button>
            <button aria-pressed={props.displayMode === "all"} onClick={() => props.onChooseDisplayMode("all")} type="button">
              Dashboard
            </button>
          </div>
          <div className="seg theme-seg" aria-label="Theme mode" role="group">
            <button aria-pressed={props.themeMode === "system"} onClick={() => props.onChooseThemeMode("system")} type="button">
              System
            </button>
            <button aria-pressed={props.themeMode === "dark"} onClick={() => props.onChooseThemeMode("dark")} type="button">
              Dark
            </button>
            <button aria-pressed={props.themeMode === "light"} onClick={() => props.onChooseThemeMode("light")} type="button">
              Light
            </button>
          </div>
        </SettingsSection>

        <SettingsSection title="Refresh">
          <label className={props.refreshEnabled ? "toggle-row refresh-row expanded" : "toggle-row refresh-row"}>
            <span>
              <strong>Regular global refresh</strong>
              <em>{props.refreshEnabled ? "On" : "Off"}</em>
            </span>
            {props.refreshEnabled && (
              <span className="refresh-interval">
                <span className="refresh-value">{props.refreshIntervalMinutes} min</span>
                <span className="refresh-stepper">
                  <button
                    aria-label="Increase refresh interval"
                    disabled={props.refreshIntervalMinutes >= MAX_REFRESH_INTERVAL_MINUTES}
                    onClick={() => props.onRefreshIntervalChange(props.refreshIntervalMinutes + 5)}
                    type="button"
                  >
                    <ChevronUp aria-hidden="true" size={12} />
                  </button>
                  <button
                    aria-label="Decrease refresh interval"
                    disabled={props.refreshIntervalMinutes <= MIN_REFRESH_INTERVAL_MINUTES}
                    onClick={() => props.onRefreshIntervalChange(props.refreshIntervalMinutes - 5)}
                    type="button"
                  >
                    <ChevronDown aria-hidden="true" size={12} />
                  </button>
                </span>
              </span>
            )}
            <input
              aria-label="Regular global refresh"
              checked={props.refreshEnabled}
              className="toggle-switch"
              onChange={(event) => props.onRefreshEnabledChange(event.target.checked)}
              type="checkbox"
            />
          </label>
        </SettingsSection>

        <SettingsSection title="Providers">
          {LOCAL_LOGIN_PROVIDERS.map((providerKey) => (
            <ProviderSettingRow
              connected={!props.disconnectedProviders[providerKey]}
              info={PROVIDERS.find((provider) => provider.id === providerKey)?.note ?? ""}
              key={providerKey}
              name={PROVIDERS.find((provider) => provider.id === providerKey)?.title ?? providerKey}
              onPrimary={() =>
                props.disconnectedProviders[providerKey]
                  ? props.onReconnectProvider(providerKey)
                  : props.onDisconnectProvider(providerKey)
              }
              primaryLabel={props.disconnectedProviders[providerKey] ? "Connect" : "Disconnect"}
            />
          ))}

          {props.hasKey ? (
            <div className="key-row provider-setting-row">
              <span className="key-status">
                <span className="auth-dot on" aria-hidden="true" />
                DeepSeek
                <span className="setting-meta">API saved</span>
              </span>
              <InfoButton label="DeepSeek info" text={PROVIDERS.find((provider) => provider.id === "deepseek")?.note ?? ""} />
              <div className="key-actions">
                <IconOnlyButton icon={<Trash2 size={13} />} label="Delete DeepSeek key" onClick={props.onDeleteKey} />
                <IconOnlyButton icon={<Plus size={13} />} label="Replace DeepSeek key" onClick={props.onBeginAddKey} />
              </div>
            </div>
          ) : (
            <div className="form-grid">
              <input
                aria-label="DeepSeek API key"
                onChange={(event) => props.onApiKeyChange(event.target.value)}
                placeholder="DeepSeek API key"
                type="password"
                value={props.apiKey}
              />
              <button disabled={!props.apiKey.trim()} onClick={props.onSaveKey} type="button">
                Save key
              </button>
            </div>
          )}
          {props.hasKey && props.isAddingKey && (
            <div className="form-grid">
              <input
                aria-label="New DeepSeek API key"
                onChange={(event) => props.onApiKeyChange(event.target.value)}
                placeholder="New DeepSeek API key"
                type="password"
                value={props.apiKey}
              />
              <button disabled={!props.apiKey.trim()} onClick={props.onSaveKey} type="button">
                Save key
              </button>
              <button className="btn ghost" onClick={props.onCancelAddKey} type="button">
                Cancel
              </button>
            </div>
          )}

          <div className="key-row provider-setting-row">
            <span className="key-status">
              <span className={props.opencodeQuotaConnected ? "auth-dot on" : "auth-dot"} aria-hidden="true" />
              OpenCode Go limits
              <span className="setting-meta">{props.opencodeQuotaConnected ? "Linked" : "Not linked"}</span>
            </span>
            <InfoButton label="OpenCode Go limits info" text={PROVIDERS.find((provider) => provider.id === "opencode")?.note ?? ""} />
            {props.opencodeQuotaConnected && (
              <IconOnlyButton icon={<Unplug size={13} />} label="Disconnect OpenCode Go limits" onClick={props.onDisconnectQuota} />
            )}
          </div>
          {!props.opencodeQuotaConnected && (
            <div className="form-grid stack">
              <input
                aria-label="OpenCode workspace URL or id"
                onChange={(event) => props.onWorkspaceChange(event.target.value)}
                placeholder="Workspace URL or wrk_ id"
                type="text"
                value={props.opencodeWorkspace}
              />
              <input
                aria-label="OpenCode cookie header"
                onChange={(event) => props.onCookieChange(event.target.value)}
                placeholder="Cookie header"
                type="password"
                value={props.opencodeCookie}
              />
              <button
                disabled={!props.opencodeCookie.trim() || !props.opencodeWorkspace.trim()}
                onClick={props.onConnectQuota}
                type="button"
              >
                Link Go limits
              </button>
            </div>
          )}
        </SettingsSection>

        <p className="storage-note">Snapshots are stored locally on this device.</p>
      </div>
    </section>
  );
}

function ProviderSettingRow({
  connected,
  info,
  name,
  onPrimary,
  primaryLabel,
}: {
  connected: boolean;
  info: string;
  name: string;
  onPrimary: () => void;
  primaryLabel: string;
}) {
  return (
    <div className="key-row provider-setting-row">
      <span className="key-status">
        <span className={connected ? "auth-dot on" : "auth-dot"} aria-hidden="true" />
        {name}
      </span>
      <InfoButton label={`${name} info`} text={info} />
      <IconOnlyButton icon={connected ? <Unplug size={13} /> : <PlugZap size={13} />} label={`${primaryLabel} ${name}`} onClick={onPrimary} />
    </div>
  );
}

function InfoButton({ label, text }: { label: string; text: string }) {
  return (
    <button aria-label={label} className="info-button" title={text} type="button">
      <Info aria-hidden="true" size={13} />
    </button>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function metricParts(line: MetricLine) {
  const percent = percentFromValue(line.value);
  const reset = resetFromValue(line.value);
  const percentText = percent === null ? null : `${trimNumber(percent)}%`;
  const value = percentText ? line.value.replace(/.*?(\d+(?:\.\d+)?)%.*/, "$1%") : line.value;

  return {
    label: line.label.replace(/\s+remaining$/i, ""),
    percent,
    percentText,
    resetText: reset,
    value: value.replace(/\s+-\s+.*$/, ""),
  };
}

function percentFromValue(value: string) {
  const match = value.match(/(\d+(?:\.\d+)?)%/);
  if (!match) {
    return null;
  }
  return Math.max(0, Math.min(100, Number(match[1])));
}

function resetFromValue(value: string) {
  const match = value.match(/resets?\s+in\s+(.+)$/i);
  if (match) {
    return `Resets in ${match[1].trim()}`;
  }

  const absolute = value.match(/-\s*(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!absolute) {
    return null;
  }

  const [, day, month, hour, minute] = absolute;
  const now = new Date();
  const resetAt = new Date(
    now.getFullYear(),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  if (resetAt.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
    resetAt.setFullYear(now.getFullYear() + 1);
  }

  return `Resets in ${durationText(Math.max(0, Math.floor((resetAt.getTime() - now.getTime()) / 1000)))}`;
}

function trimNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function durationText(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default App;
