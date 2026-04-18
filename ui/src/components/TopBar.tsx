import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Download,
  FolderPlus,
  ImagePlus,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchHealth, type HealthResponse } from "@/lib/api";
import {
  downloadUpiqloFile,
  exportSession,
  importSession,
  pickUpiqloFile,
} from "@/lib/session-io";
import { useSessions } from "@/state/sessions";

type EngineStatus =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

/**
 * The global top bar. Stays compact: brand, quick-new-session icons,
 * save/open for the active session, and the engine status chip.
 *
 * Per-session parameters live INSIDE each session's workspace now
 * (see SessionConfigBar).
 */
export function TopBar() {
  const [engine, setEngine] = useState<EngineStatus>({ kind: "loading" });
  const openSession = useSessions((s) => s.openSession);
  const hydrateSession = useSessions((s) => s.hydrateSession);
  const activeSession = useSessions((s) => {
    const a = s.sessions.find((x) => x.id === s.activeId);
    return a ?? null;
  });
  const hasSessions = useSessions((s) => s.sessions.length > 0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const check = async () => {
      try {
        const h = await fetchHealth();
        if (!cancelled) setEngine({ kind: "ok", health: h });
      } catch (e) {
        if (!cancelled) setEngine({ kind: "error", message: (e as Error).message });
      } finally {
        if (!cancelled) timer = window.setTimeout(check, 5000);
      }
    };
    check();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const onImport = async () => {
    const doc = await pickUpiqloFile();
    if (doc) {
      try {
        const sess = importSession(doc);
        hydrateSession(sess);
      } catch (e) {
        alert(`Import failed: ${(e as Error).message}`);
      }
    }
  };

  const onExport = () => {
    if (!activeSession) return;
    downloadUpiqloFile(
      exportSession(activeSession),
      activeSession.title.replace(/\s+/g, "_"),
    );
  };

  return (
    <header className="h-11 border-b border-surface-border flex items-center px-3 gap-2 bg-surface-raised shrink-0">
      <div className="w-7 h-7 rounded-md bg-accent/20 border border-accent/40 flex items-center justify-center">
        <Activity size={16} className="text-accent" />
      </div>
      <div className="flex items-baseline gap-2">
        <h1 className="text-sm font-semibold tracking-wide">Upiqlo</h1>
        <span className="text-[11px] text-text-faint">FR-IQA Image Comparison</span>
      </div>

      <div className="h-5 w-px bg-surface-border mx-1" />

      {/* Compact new-session icons — always visible at the top level. */}
      <IconButton
        onClick={() => openSession("single")}
        label="New file comparison"
        icon={<ImagePlus size={14} />}
      />
      <IconButton
        onClick={() => openSession("folder")}
        label="New folder comparison"
        icon={<FolderPlus size={14} />}
      />

      <div className="h-5 w-px bg-surface-border mx-1" />

      <IconButton
        onClick={onImport}
        label="Open session (.upiqlo)"
        icon={<Upload size={14} />}
      />
      <IconButton
        onClick={onExport}
        label={activeSession ? "Save session (.upiqlo)" : "No active session to save"}
        disabled={!activeSession}
        icon={<Download size={14} />}
      />

      <div className="flex-1" />

      {!hasSessions && (
        <span className="text-[11px] text-text-faint mr-2">No session open</span>
      )}
      <EngineChip status={engine} />
    </header>
  );
}

function IconButton({
  onClick,
  label,
  icon,
  disabled,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="w-7 h-7 flex items-center justify-center rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
    </button>
  );
}

function EngineChip({ status }: { status: EngineStatus }) {
  const { Icon, label, cls } = (() => {
    if (status.kind === "ok") {
      return {
        Icon: CheckCircle2,
        label: `Engine ${status.health.version} · ${status.health.algorithm_available ? "ready" : "no algo"}`,
        cls: "border-signal-success/40 bg-signal-success/10 text-signal-success",
      };
    }
    if (status.kind === "error") {
      return {
        Icon: AlertCircle,
        label: "Engine offline",
        cls: "border-signal-danger/50 bg-signal-danger/10 text-signal-danger",
      };
    }
    return {
      Icon: Activity,
      label: "Checking engine…",
      cls: "border-surface-border bg-surface-sunken text-text-muted",
    };
  })();

  return (
    <div
      className={cn("flex items-center gap-2 text-[11px] px-2 py-1 rounded-md border", cls)}
      title={status.kind === "error" ? status.message : undefined}
    >
      <Icon size={14} />
      <span>{label}</span>
    </div>
  );
}
