import { Activity, AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { fetchHealth, type HealthResponse } from "@/lib/api";
import { usePreferences, type Preferences } from "@/state/preferences";
import { useSessions } from "@/state/sessions";

type EngineStatus =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

export function TopBar() {
  const [engine, setEngine] = useState<EngineStatus>({ kind: "loading" });
  const prefs = usePreferences();
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const updateParams = useSessions((s) => s.updateParams);
  const resetParams = useSessions((s) => s.resetParams);
  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  // Effective parameter view: when a session is active, the TopBar reflects
  // and edits THAT session's snapshot. Without an active session, it falls
  // back to the global defaults.
  const effective: Preferences = activeSession ? activeSession.params : prefs;

  const onUpdate = (patch: Partial<Preferences>) => {
    if (activeSession) {
      updateParams(activeSession.id, patch);
    } else {
      prefs.update(patch);
    }
  };
  const onReset = () => {
    if (activeSession) {
      resetParams(activeSession.id);
    } else {
      prefs.reset();
    }
  };

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

  return (
    <header className="h-12 border-b border-surface-border flex items-center px-3 gap-3 bg-surface-raised shrink-0">
      <div className="w-7 h-7 rounded-md bg-accent/20 border border-accent/40 flex items-center justify-center">
        <Activity size={16} className="text-accent" />
      </div>
      <div className="flex items-baseline gap-2">
        <h1 className="text-sm font-semibold tracking-wide">Upiqlo</h1>
        <span className="text-[11px] text-text-faint">FR-IQA Image Comparison</span>
      </div>

      <div className="h-5 w-px bg-surface-border mx-1" />

      {/* Parameters — bound to the active session's snapshot (or globals
          if no session is open). A small pill indicates scope. */}
      <span
        className={cn(
          "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
          activeSession
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-surface-border text-text-faint",
        )}
        title={
          activeSession
            ? `Editing params for the active tab; each tab has its own snapshot`
            : "No tab open — editing global defaults"
        }
      >
        {activeSession ? "tab" : "global"}
      </span>
      <SliderField
        label="Max side"
        value={effective.maxSide}
        min={256}
        max={2048}
        step={64}
        suffix="px"
        onChange={(v) => onUpdate({ maxSide: v })}
      />
      <SliderField
        label="Feature side"
        value={effective.featureSide}
        min={128}
        max={512}
        step={16}
        suffix="px"
        onChange={(v) => onUpdate({ featureSide: v })}
      />
      <Toggle
        label="Pyramid"
        checked={effective.pyramid}
        onChange={(v) => onUpdate({ pyramid: v })}
      />
      <Segmented
        label="Score"
        value={effective.scoreMode}
        options={[
          { value: "sigmoid", label: "Sigmoid" },
          { value: "nll", label: "NLL" },
        ]}
        onChange={(v) => onUpdate({ scoreMode: v as "sigmoid" | "nll" })}
      />
      <button
        type="button"
        onClick={onReset}
        className="text-[11px] px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface/60 flex items-center gap-1"
        title={activeSession ? "Reset this tab's params to current globals" : "Reset global params"}
      >
        <RotateCcw size={12} /> Reset
      </button>

      <div className="flex-1" />

      <EngineChip status={engine} />
    </header>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}

function SliderField(props: SliderFieldProps) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-text-muted">
      <span className="whitespace-nowrap">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-24 accent-accent"
      />
      <span className="tabular-nums text-text w-14">
        {props.value}
        {props.suffix}
      </span>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent"
      />
      <span>{label}</span>
    </label>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
      <span>{label}</span>
      <div className="flex rounded-md border border-surface-border overflow-hidden">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "px-2 py-1 transition-colors",
              value === o.value
                ? "bg-accent/15 text-accent"
                : "hover:bg-surface/60 hover:text-text",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
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
