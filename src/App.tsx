import { type MouseEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Minus,
  PlugZap,
  Plus,
  RefreshCw,
  Settings,
  Star,
  Trash2,
  Unplug,
} from "lucide-react";
import "./App.css";
import limitLensLogo from "../src-tauri/icons/limitlens-logo.svg";
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
type ThemeMode = "system" | "light" | "dark" | "tokyo-night";
type ProviderKey = "codex" | "claude" | "deepseek" | "opencode";
type DashboardView = "all" | ProviderKey;
type LifecycleState = "refreshing" | "fresh" | "stale" | "error" | "empty";
type DisconnectedProviders = Partial<Record<ProviderKey, boolean>>;
type StarredProviders = Partial<Record<ProviderKey, boolean>>;
type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";
const WINDOW_LABEL = getCurrentWindow().label;

const COMPACT_LAYOUT_MAX_WIDTH = 519;
const COMPACT_LAYOUT_MAX_HEIGHT = 419;
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
  { id: "opencode", title: "OpenCode Go", icon: opencodeIcon, note: "Links an OpenCode console session to show Go limits. Local device DB spend is a possible fallback idea, not current app code.", emptyLabel: "Go limits not linked" },
];

function readDashboardView(): DashboardView {
  const value = readPersisted("limitlens.dashboardView", readPersisted("limitlens.selectedProvider", "all"));
  if (value === "all") return "all";
  return PROVIDERS.some((provider) => provider.id === value) ? (value as ProviderKey) : "all";
}

function readThemeMode() {
  const value = readPersisted("limitlens.themeMode", "system");
  return value === "system" || value === "light" || value === "dark" || value === "tokyo-night" ? value : "system";
}

function readRefreshEnabled() {
  return readPersisted("limitlens.refreshEnabled", "false") === "true";
}

function readGlanceEnabled() {
  return readPersisted("limitlens.glanceEnabled", "true") !== "false";
}

type GlancePosition = {
  x: number;
  y: number;
};

function readGlancePosition(): GlancePosition | null {
  const value = readPersisted("limitlens.glancePosition", "");
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as GlancePosition;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: Math.round(parsed.x), y: Math.round(parsed.y) };
  } catch {
    return null;
  }
}

function readRefreshIntervalMinutes() {
  const value = Number(readPersisted("limitlens.refreshIntervalMinutes", String(DEFAULT_REFRESH_INTERVAL_MINUTES)));
  if (!Number.isFinite(value)) return DEFAULT_REFRESH_INTERVAL_MINUTES;
  return Math.min(MAX_REFRESH_INTERVAL_MINUTES, Math.max(MIN_REFRESH_INTERVAL_MINUTES, Math.round(value)));
}

function readDisconnectedProviders(): DisconnectedProviders {
  const value = readPersisted("limitlens.disconnectedProviders", "{}");
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

function readStarredProviders(): StarredProviders {
  const value = readPersisted("limitlens.starredProviders", "{}");
  try {
    const parsed = JSON.parse(value) as StarredProviders;
    return PROVIDERS.reduce<StarredProviders>((next, provider) => {
      if (parsed[provider.id] === true) next[provider.id] = true;
      return next;
    }, {});
  } catch {
    return {};
  }
}

function percentLabelFromValue(value: string): string | null {
  const percent = percentFromValue(value);
  if (percent === null) return null;
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage is best-effort; if unavailable we degrade gracefully.
  }
}

function readPersisted(key: string, fallback: string) {
  const legacyKey = key.replace("limitlens.", "infusage.");
  try {
    const currentValue = localStorage.getItem(key);
    if (currentValue !== null) return currentValue;

    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue !== null) {
      localStorage.setItem(key, legacyValue);
      localStorage.removeItem(legacyKey);
      return legacyValue;
    }

    return fallback;
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
  return <img className="brand-mark" src={limitLensLogo} alt="" aria-hidden="true" />;
}

function useResponsiveDisplayMode(): DisplayMode {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    function updateSize() {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    }

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  return size.width <= COMPACT_LAYOUT_MAX_WIDTH || size.height <= COMPACT_LAYOUT_MAX_HEIGHT ? "minimal" : "all";
}

function App() {
  if (WINDOW_LABEL === "glance") {
    return <GlanceApp />;
  }

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
  const displayMode = useResponsiveDisplayMode();
  const [dashboardView, setDashboardView] = useState<DashboardView>(readDashboardView);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [refreshEnabled, setRefreshEnabled] = useState(readRefreshEnabled);
  const [refreshIntervalMinutes, setRefreshIntervalMinutes] = useState(readRefreshIntervalMinutes);
  const [disconnectedProviders, setDisconnectedProviders] = useState<DisconnectedProviders>(readDisconnectedProviders);
  const [starredProviders, setStarredProviders] = useState<StarredProviders>(readStarredProviders);
  const [glanceEnabled, setGlanceEnabled] = useState(readGlanceEnabled);

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
    persist("limitlens.dashboardView", dashboardView);
    if (dashboardView !== "all") persist("limitlens.selectedProvider", dashboardView);
  }, [dashboardView]);

  useEffect(() => {
    persist("limitlens.themeMode", themeMode);
    emit("settings-updated").catch(() => {});
  }, [themeMode]);

  useEffect(() => {
    persist("limitlens.disconnectedProviders", JSON.stringify(disconnectedProviders));
  }, [disconnectedProviders]);

  useEffect(() => {
    if (dashboardView !== "all" && disconnectedProviders[dashboardView]) {
      setDashboardView("all");
    }
  }, [dashboardView, disconnectedProviders]);

  useEffect(() => {
    persist("limitlens.starredProviders", JSON.stringify(starredProviders));
    emit("settings-updated").catch(() => {});
  }, [starredProviders]);

  useEffect(() => {
    persist("limitlens.refreshIntervalMinutes", String(refreshIntervalMinutes));
  }, [refreshIntervalMinutes]);

  useEffect(() => {
    persist("limitlens.refreshEnabled", String(refreshEnabled));
  }, [refreshEnabled]);

  useEffect(() => {
    persist("limitlens.glanceEnabled", String(glanceEnabled));
    const position = readGlancePosition();
    invoke(
      "set_glance_visible",
      position ? { visible: glanceEnabled, x: position.x, y: position.y } : { visible: glanceEnabled },
    ).catch(() => {});
  }, [glanceEnabled]);

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
      emit("snapshots-updated").catch(() => {});
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

  function startWindowResize(direction: ResizeDirection, event: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void getCurrentWindow().startResizeDragging(direction);
  }

  function hideTray() {
    invoke("request_tray_close").catch(() => invoke("hide_tray_window").catch(() => {}));
  }

  function disconnectProvider(key: ProviderKey) {
    setDisconnectedProviders((current) => ({ ...current, [key]: true }));
    setSnapshots((current) => ({ ...current, [key]: null }));
    setLastUpdatedAt((current) => ({ ...current, [key]: 0 }));
    setProviderError(key, null);
    setDashboardView("all");
  }

  async function reconnectProvider(key: ProviderKey) {
    setDisconnectedProviders((current) => ({ ...current, [key]: false }));
    setDashboardView(key);
    setAddProviderOpen(false);
    if (key === "codex") await refreshCodex();
    if (key === "claude") await refreshClaude();
    if (key === "deepseek" && hasKey) await refreshDeepSeek();
    if (key === "opencode" && opencodeQuotaConnected) await refreshOpenCode();
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
      if (disconnectedProviders[key]) hint = "Reconnect from this provider page";
      else if (key === "deepseek" && !hasKey) hint = "Add an API key from the DeepSeek page";
      else if (key === "opencode" && !opencodeQuotaConnected) hint = "Link Go limits from the OpenCode page";
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

  function toggleStarredProvider(key: ProviderKey) {
    setStarredProviders((current) => ({ ...current, [key]: !current[key] }));
  }

  const orderedProviders = [...PROVIDERS].sort((left, right) => {
    const leftStarred = starredProviders[left.id] ? 1 : 0;
    const rightStarred = starredProviders[right.id] ? 1 : 0;
    return rightStarred - leftStarred;
  });
  const visibleProviders = orderedProviders.filter((provider) => !disconnectedProviders[provider.id]);
  const disconnectedProviderList = PROVIDERS.filter((provider) => disconnectedProviders[provider.id]);
  const selectedProvider = dashboardView === "all" ? null : dashboardView;
  const selectedProviderMeta = selectedProvider ? PROVIDERS.find((provider) => provider.id === selectedProvider) ?? PROVIDERS[0] : null;
  const syncedCount = visibleProviders.filter((provider) => snapshots[provider.id]).length;

  return (
    <main
      className={`${displayMode === "minimal" ? "panel minimal" : "panel"}${opening ? " opening" : ""}${closing ? " closing" : ""}`}
      data-theme={themeMode}
    >
      {[
        ["resize-grip-n", "North"],
        ["resize-grip-e", "East"],
        ["resize-grip-s", "South"],
        ["resize-grip-w", "West"],
        ["resize-grip-ne", "NorthEast"],
        ["resize-grip-nw", "NorthWest"],
        ["resize-grip-se", "SouthEast"],
        ["resize-grip-sw", "SouthWest"],
      ].map(([className, direction]) => (
        <span
          aria-hidden="true"
          className={`resize-grip ${className}`}
          key={direction}
          onMouseDown={(event) => startWindowResize(direction as ResizeDirection, event)}
        />
      ))}
      <header className="panel-header" onPointerDown={startWindowDrag}>
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <h1>LimitLens</h1>
            <p>Usage limits</p>
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
          <button aria-label="Hide window" className="icon-button" onClick={hideTray} type="button">
            <Minus aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsSheet
          themeMode={themeMode}
          glanceEnabled={glanceEnabled}
          onChooseThemeMode={setThemeMode}
          refreshEnabled={refreshEnabled}
          refreshIntervalMinutes={refreshIntervalMinutes}
          onRefreshEnabledChange={setRefreshEnabled}
          onGlanceEnabledChange={setGlanceEnabled}
          onRefreshIntervalChange={chooseRefreshInterval}
        />
      ) : (
        <section className={displayMode === "minimal" ? "dashboard-shell compact" : "dashboard-shell"} aria-label="Dashboard">
          <aside className="dashboard-sidebar" aria-label="Providers">
            <div className="sidebar-head">
              <p className="sidebar-title">Providers</p>
              <button
                aria-expanded={addProviderOpen}
                aria-label="Add provider"
                className="sidebar-add"
                onClick={() => setAddProviderOpen((current) => !current)}
                title="Add provider"
                type="button"
              >
                <Plus aria-hidden="true" size={13} />
              </button>
            </div>
            {addProviderOpen && (
              <AddProviderMenu
                providers={disconnectedProviderList}
                onAdd={(providerKey) => void reconnectProvider(providerKey)}
              />
            )}
            <nav className="provider-nav" aria-label="Pick provider">
              <button
                aria-label="All providers"
                aria-pressed={dashboardView === "all"}
                className="provider-nav-item all-view"
                onClick={() => setDashboardView("all")}
                type="button"
              >
                <span className="rail-mark all-mark">All</span>
                <span className="provider-nav-label">All</span>
                <span className="rail-count">{syncedCount}</span>
              </button>
              {visibleProviders.map((provider) => (
                <button
                  aria-label={provider.title}
                  aria-pressed={dashboardView === provider.id}
                  className="provider-nav-item"
                  key={provider.id}
                  onClick={() => setDashboardView(provider.id)}
                  type="button"
                >
                  <span className="rail-mark">
                    <img alt="" src={provider.icon} />
                  </span>
                  <span className="provider-nav-label">{provider.title}</span>
                  <span className="nav-status">
                    {starredProviders[provider.id] && <Star aria-hidden="true" className="nav-star-indicator" size={10} />}
                    <span className={authConnected(provider.id) ? "rail-dot on" : "rail-dot"} />
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <div className="dashboard-main">
            {dashboardView === "all" ? (
              <AllDashboardView
                cardFor={cardFor}
                providers={visibleProviders}
                syncedCount={syncedCount}
                snapshotCount={visibleProviders.length}
                compact={displayMode === "minimal"}
              />
            ) : (
              selectedProvider &&
              selectedProviderMeta && (
                <ProviderDashboardView
                  apiKey={apiKey}
                  card={cardFor(selectedProvider)}
                  disconnected={Boolean(disconnectedProviders[selectedProvider])}
                  hasKey={hasKey}
                  isAddingKey={isAddingKey}
                  isStarred={Boolean(starredProviders[selectedProvider])}
                  meta={selectedProviderMeta}
                  opencodeCookie={opencodeCookie}
                  opencodeQuotaConnected={opencodeQuotaConnected}
                  opencodeWorkspace={opencodeWorkspace}
                  providerKey={selectedProvider}
                  onApiKeyChange={setApiKey}
                  onBeginAddKey={beginKeyReplace}
                  onCancelAddKey={cancelKeyReplace}
                  onConnectQuota={connectQuota}
                  onCookieChange={setOpencodeCookie}
                  onDeleteKey={deleteSavedKey}
                  onDisconnectProvider={disconnectProvider}
                  onDisconnectQuota={disconnectQuota}
                  onReconnectProvider={reconnectProvider}
                  onSaveKey={saveKey}
                  onToggleStar={() => toggleStarredProvider(selectedProvider)}
                  onWorkspaceChange={setOpencodeWorkspace}
                />
              )
            )}
          </div>
        </section>
      )}

      {!settingsOpen && displayMode === "all" && (
        <footer className="panel-foot">
          {Object.values(snapshots).every((snapshot) => snapshot === null)
            ? "No data yet - open a provider page to connect providers."
            : "Snapshots are stored locally."}
        </footer>
      )}
    </main>
  );
}

function AllDashboardView({
  cardFor,
  compact,
  providers,
  snapshotCount,
  syncedCount,
}: {
  cardFor: (key: ProviderKey) => ReactNode;
  compact: boolean;
  providers: ProviderMeta[];
  snapshotCount: number;
  syncedCount: number;
}) {
  return (
    <section className="dashboard-view all-dashboard-view" aria-label="All providers">
      {!compact && (
        <div className="dashboard-intro">
          <div>
            <h2>All providers</h2>
            <p>Usage, tokens, models, and spend across connected providers.</p>
          </div>
          <span>
            {syncedCount}/{snapshotCount} synced
          </span>
        </div>
      )}
      {!compact && (
        <div className="analytics-grid" aria-label="Analytics placeholders">
          <AnalyticsTile label="Usage" value="Live" note="Current provider limit snapshots" />
          <AnalyticsTile label="Tokens" value="Soon" note="Normalized token usage across models" />
          <AnalyticsTile label="Models" value="Soon" note="Filter usage by model/provider" />
          <AnalyticsTile label="Price" value="Soon" note="Subscription spend and extra usage" />
        </div>
      )}
      <div className="provider-list" key={compact ? "compact-all" : "all"}>
        {providers.map((provider) => (
          <section aria-label={provider.title} className="card-slot" key={provider.id}>
            {cardFor(provider.id)}
          </section>
        ))}
      </div>
    </section>
  );
}

function AddProviderMenu({
  onAdd,
  providers,
}: {
  onAdd: (key: ProviderKey) => void;
  providers: ProviderMeta[];
}) {
  return (
    <section className="add-provider-menu" aria-label="Add provider">
      {providers.length === 0 ? (
        <p>All providers are visible.</p>
      ) : (
        providers.map((provider) => (
          <button key={provider.id} onClick={() => onAdd(provider.id)} type="button">
            <span className="rail-mark">
              <img alt="" src={provider.icon} />
            </span>
            <span>{provider.title}</span>
            <Plus aria-hidden="true" size={12} />
          </button>
        ))
      )}
    </section>
  );
}

function ProviderDashboardView({
  apiKey,
  card,
  disconnected,
  hasKey,
  isAddingKey,
  isStarred,
  meta,
  opencodeCookie,
  opencodeQuotaConnected,
  opencodeWorkspace,
  providerKey,
  onApiKeyChange,
  onBeginAddKey,
  onCancelAddKey,
  onConnectQuota,
  onCookieChange,
  onDeleteKey,
  onDisconnectProvider,
  onDisconnectQuota,
  onReconnectProvider,
  onSaveKey,
  onToggleStar,
  onWorkspaceChange,
}: {
  apiKey: string;
  card: ReactNode;
  disconnected: boolean;
  hasKey: boolean;
  isAddingKey: boolean;
  isStarred: boolean;
  meta: ProviderMeta;
  opencodeCookie: string;
  opencodeQuotaConnected: boolean;
  opencodeWorkspace: string;
  providerKey: ProviderKey;
  onApiKeyChange: (value: string) => void;
  onBeginAddKey: () => void;
  onCancelAddKey: () => void;
  onConnectQuota: () => void;
  onCookieChange: (value: string) => void;
  onDeleteKey: () => void;
  onDisconnectProvider: (key: ProviderKey) => void;
  onDisconnectQuota: () => void;
  onReconnectProvider: (key: ProviderKey) => void;
  onSaveKey: () => void;
  onToggleStar: () => void;
  onWorkspaceChange: (value: string) => void;
}) {
  return (
    <section className="dashboard-view provider-page" aria-label={`${meta.title} dashboard`}>
      <div className="provider-hero">
        <div className="detail-heading">
          <span className="detail-mark">
            <img alt="" src={meta.icon} />
          </span>
          <div>
            <h2>{meta.title}</h2>
            <p>{meta.note}</p>
          </div>
        </div>
        <div className="provider-page-actions">
          <button aria-pressed={isStarred} className="star-button" onClick={onToggleStar} type="button">
            <Star aria-hidden="true" size={13} />
            {isStarred ? "Starred" : "Star"}
          </button>
          {(providerKey === "codex" || providerKey === "claude") && (
            <button
              className="btn ghost"
              onClick={() => (disconnected ? void onReconnectProvider(providerKey) : onDisconnectProvider(providerKey))}
              type="button"
            >
              {disconnected ? <PlugZap aria-hidden="true" size={13} /> : <Unplug aria-hidden="true" size={13} />}
              {disconnected ? "Reconnect" : "Disconnect"}
            </button>
          )}
        </div>
      </div>

      <div className="provider-page-grid">
        <div className="provider-current">{card}</div>
        <ProviderSetupPanel
          apiKey={apiKey}
          hasKey={hasKey}
          isAddingKey={isAddingKey}
          opencodeCookie={opencodeCookie}
          opencodeQuotaConnected={opencodeQuotaConnected}
          opencodeWorkspace={opencodeWorkspace}
          providerKey={providerKey}
          onApiKeyChange={onApiKeyChange}
          onBeginAddKey={onBeginAddKey}
          onCancelAddKey={onCancelAddKey}
          onConnectQuota={onConnectQuota}
          onCookieChange={onCookieChange}
          onDeleteKey={onDeleteKey}
          onDisconnectQuota={onDisconnectQuota}
          onSaveKey={onSaveKey}
          onWorkspaceChange={onWorkspaceChange}
        />
      </div>

      <div className="analytics-grid provider-analytics" aria-label={`${meta.title} future analytics`}>
        <AnalyticsTile label="Token usage" value="Soon" note="Per-model token totals will appear here." />
        <AnalyticsTile label="Price usage" value="Soon" note="Subscription spend and usage price." />
        <AnalyticsTile label="Extra usage" value="Soon" note="Overage or extra credits where providers expose it." />
        <AnalyticsTile label="Model filters" value="Soon" note="Filter by model, date range, and source." />
      </div>
    </section>
  );
}

function ProviderSetupPanel({
  apiKey,
  hasKey,
  isAddingKey,
  opencodeCookie,
  opencodeQuotaConnected,
  opencodeWorkspace,
  providerKey,
  onApiKeyChange,
  onBeginAddKey,
  onCancelAddKey,
  onConnectQuota,
  onCookieChange,
  onDeleteKey,
  onDisconnectQuota,
  onSaveKey,
  onWorkspaceChange,
}: {
  apiKey: string;
  hasKey: boolean;
  isAddingKey: boolean;
  opencodeCookie: string;
  opencodeQuotaConnected: boolean;
  opencodeWorkspace: string;
  providerKey: ProviderKey;
  onApiKeyChange: (value: string) => void;
  onBeginAddKey: () => void;
  onCancelAddKey: () => void;
  onConnectQuota: () => void;
  onCookieChange: (value: string) => void;
  onDeleteKey: () => void;
  onDisconnectQuota: () => void;
  onSaveKey: () => void;
  onWorkspaceChange: (value: string) => void;
}) {
  return (
    <section className="provider-setup" aria-label="Provider setup">
      <div className="section-head">
        <h3>Provider setup</h3>
        <p>Connection and provider-specific options.</p>
      </div>

      {(providerKey === "codex" || providerKey === "claude") && (
        <p className="section-note">Uses your local CLI login. Disconnect hides this provider until you reconnect it.</p>
      )}

      {providerKey === "deepseek" &&
        (hasKey ? (
          <>
            <div className="key-row provider-setting-row">
              <span className="key-status">
                <span className="auth-dot on" aria-hidden="true" />
                DeepSeek
                <span className="setting-meta">API saved</span>
              </span>
              <div className="key-actions">
                <IconOnlyButton icon={<Trash2 size={13} />} label="Delete DeepSeek key" onClick={onDeleteKey} />
                <IconOnlyButton icon={<Plus size={13} />} label="Replace DeepSeek key" onClick={onBeginAddKey} />
              </div>
            </div>
            {isAddingKey && (
              <div className="form-grid">
                <input
                  aria-label="New DeepSeek API key"
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  placeholder="New DeepSeek API key"
                  type="password"
                  value={apiKey}
                />
                <button disabled={!apiKey.trim()} onClick={onSaveKey} type="button">
                  Save key
                </button>
                <button className="btn ghost" onClick={onCancelAddKey} type="button">
                  Cancel
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="form-grid">
            <input
              aria-label="DeepSeek API key"
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder="DeepSeek API key"
              type="password"
              value={apiKey}
            />
            <button disabled={!apiKey.trim()} onClick={onSaveKey} type="button">
              Save key
            </button>
          </div>
        ))}

      {providerKey === "opencode" && (
        <>
          <div className="key-row provider-setting-row">
            <span className="key-status">
              <span className={opencodeQuotaConnected ? "auth-dot on" : "auth-dot"} aria-hidden="true" />
              OpenCode Go limits
              <span className="setting-meta">{opencodeQuotaConnected ? "Linked" : "Not linked"}</span>
            </span>
            {opencodeQuotaConnected && (
              <IconOnlyButton icon={<Unplug size={13} />} label="Disconnect OpenCode Go limits" onClick={onDisconnectQuota} />
            )}
          </div>
          {!opencodeQuotaConnected && (
            <div className="form-grid stack">
              <input
                aria-label="OpenCode workspace URL or id"
                onChange={(event) => onWorkspaceChange(event.target.value)}
                placeholder="Workspace URL or wrk_ id"
                type="text"
                value={opencodeWorkspace}
              />
              <input
                aria-label="OpenCode cookie header"
                onChange={(event) => onCookieChange(event.target.value)}
                placeholder="Cookie header"
                type="password"
                value={opencodeCookie}
              />
              <button disabled={!opencodeCookie.trim() || !opencodeWorkspace.trim()} onClick={onConnectQuota} type="button">
                Link Go limits
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AnalyticsTile({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <section className="analytics-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{note}</p>
    </section>
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

function GlanceApp() {
  const [snapshots, setSnapshots] = useState<Record<string, ProviderSnapshot | null>>({});
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const [starredProviders, setStarredProviders] = useState<StarredProviders>(readStarredProviders);
  const [disconnectedProviders, setDisconnectedProviders] = useState<DisconnectedProviders>(readDisconnectedProviders);
  const glanceWindow = useMemo(() => getCurrentWindow(), []);
  const suppressOpenUntil = useRef(0);

  async function loadSnapshots() {
    try {
      const savedSnapshots = await invoke<SavedSnapshot[]>("list_saved_snapshots");
      setSnapshots(
        savedSnapshots.reduce<Record<string, ProviderSnapshot>>((next, saved) => {
          next[saved.provider_id] = saved.snapshot;
          return next;
        }, {}),
      );
    } catch {
      setSnapshots({});
    }
  }

  useEffect(() => {
    void loadSnapshots();

    const unlistenPromise = listen("snapshots-updated", () => {
      void loadSnapshots();
    });
    const settingsUnlistenPromise = listen("settings-updated", () => {
      setThemeMode(readThemeMode());
      setStarredProviders(readStarredProviders());
      setDisconnectedProviders(readDisconnectedProviders());
    });
    const interval = window.setInterval(() => {
      void loadSnapshots();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
      unlistenPromise.then((unlisten) => unlisten()).catch(() => {});
      settingsUnlistenPromise.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !(event.target as HTMLElement).closest(".glance-grip")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressOpenUntil.current = Date.now() + 900;
    void glanceWindow.startDragging();
    window.setTimeout(() => {
      void glanceWindow.outerPosition().then((position) => {
        persist("limitlens.glancePosition", JSON.stringify({ x: position.x, y: position.y }));
        invoke("set_glance_position", { x: position.x, y: position.y }).catch(() => {});
      });
    }, 600);
  }

  function openDashboard() {
    if (Date.now() < suppressOpenUntil.current) {
      return;
    }
    invoke("show_tray_window").catch(() => {});
  }

  const starredKeys = PROVIDERS.filter((provider) => starredProviders[provider.id] && !disconnectedProviders[provider.id]).map(
    (provider) => provider.id,
  );
  const defaultGlanceKeys = (["codex", "claude", "opencode"] as ProviderKey[]).filter((key) => !disconnectedProviders[key]);
  const glanceKeys = starredKeys.length > 0 ? starredKeys : defaultGlanceKeys;
  const items = glanceKeys
    .slice(0, 4)
    .map((key) => {
      const meta = PROVIDERS.find((provider) => provider.id === key)!;
      return key === "deepseek"
        ? glanceBalanceItem(key, meta.icon, snapshots[key])
        : glanceItem(key, meta.icon, snapshots[key], key === "opencode" ? "Rolling" : "Session", "Weekly");
    });

  return (
    <button
      aria-label="Open LimitLens dashboard"
      className="glance-bar"
      data-theme={themeMode}
      onClick={openDashboard}
      onPointerDown={startDrag}
      title="Drag to position. Click to open LimitLens dashboard."
      type="button"
    >
      <span className="glance-grip" aria-hidden="true" />
      {items.map((item) => (
        <span className={item.empty ? "glance-cell empty" : "glance-cell"} key={item.id}>
          <span className="glance-icon">
            <img alt="" src={item.icon} />
          </span>
          <span className="glance-metrics">
            <strong>{item.current ?? "--"}</strong>
            {item.weekly !== null && (
              <>
                <span aria-hidden="true">|</span>
                <span>{item.weekly ?? "--"}</span>
              </>
            )}
          </span>
        </span>
      ))}
    </button>
  );
}

function glanceBalanceItem(id: ProviderKey, icon: string, snapshot: ProviderSnapshot | null | undefined) {
  const usd = snapshot?.lines.find((line) => line.label.toUpperCase() === "USD");
  return {
    id,
    icon,
    current: usd ? dollarLabel(usd.value) : null,
    weekly: null,
    empty: !usd,
  };
}

function glanceItem(
  id: ProviderKey,
  icon: string,
  snapshot: ProviderSnapshot | null | undefined,
  currentLabel: string,
  weeklyLabel: string,
) {
  const current = snapshot?.lines.find((line) => line.label === currentLabel);
  const weekly = snapshot?.lines.find((line) => line.label === weeklyLabel);
  return {
    id,
    icon,
    current: current ? percentLabelFromValue(current.value) : null,
    weekly: weekly ? percentLabelFromValue(weekly.value) : null,
    empty: !current && !weekly,
  };
}

function dollarLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "$0.00";
  if (trimmed.startsWith("$")) return trimmed;
  const amount = Number(trimmed);
  if (Number.isFinite(amount)) return `$${amount.toFixed(2)}`;
  return trimmed;
}

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
  const percent = metric.percent === null ? null : Math.max(0, Math.min(100, metric.percent));
  return (
    <div className="metric-row">
      <div className="metric-copy">
        <div className="metric-label">
          <span>{metric.label}</span>
          {metric.resetText && <em>- {metric.resetText}</em>}
        </div>
        {metric.percentText ? <strong>{metric.percentText}</strong> : <strong>{metric.value}</strong>}
      </div>
      {percent !== null && (
        <div
          aria-label={metric.label}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(percent)}
          className="metric-progress"
          role="progressbar"
        >
          <div className="metric-progress-fill" style={{ width: `${percent}%` }} />
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
  themeMode: ThemeMode;
  glanceEnabled: boolean;
  onChooseThemeMode: (mode: ThemeMode) => void;
  refreshEnabled: boolean;
  refreshIntervalMinutes: number;
  onRefreshEnabledChange: (value: boolean) => void;
  onGlanceEnabledChange: (value: boolean) => void;
  onRefreshIntervalChange: (value: number) => void;
};

function SettingsSheet(props: SettingsSheetProps) {
  return (
    <section className="settings-sheet" aria-label="Settings">
      <div className="settings-body">
        <SettingsSection title="Display">
          <p className="section-note">
            Layout follows the window size automatically: compact when small, dashboard when there is room.
          </p>
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
            <button aria-pressed={props.themeMode === "tokyo-night"} onClick={() => props.onChooseThemeMode("tokyo-night")} type="button">
              Tokyo
            </button>
          </div>
        </SettingsSection>

        <SettingsSection title="Glance">
          <label className="toggle-row">
            <span>
              <strong>Glance widget</strong>
              <em>{props.glanceEnabled ? "Codex visible" : "Off"}</em>
            </span>
            <input
              aria-label="Glance widget"
              checked={props.glanceEnabled}
              className="toggle-switch"
              onChange={(event) => props.onGlanceEnabledChange(event.target.checked)}
              type="checkbox"
            />
          </label>
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

        <p className="storage-note">Provider setup now lives on each provider page. Snapshots are stored locally on this device.</p>
      </div>
    </section>
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
  const percentText = percent === null ? null : `${percent}%`;
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

function durationText(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default App;
