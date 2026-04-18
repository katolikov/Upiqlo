import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessions } from "@/state/sessions";
import type { Preferences } from "@/state/preferences";

interface Props {
  sessionId: string;
  params: Preferences;
}

/**
 * Per-session configuration strip, rendered at the top of the active
 * session's workspace. Edits go into THIS session's params snapshot,
 * so two tabs open at once can run with different settings.
 */
export function SessionConfigBar({ sessionId, params }: Props) {
  const updateParams = useSessions((s) => s.updateParams);
  const resetParams = useSessions((s) => s.resetParams);

  const onUpdate = (patch: Partial<Preferences>) => updateParams(sessionId, patch);

  return (
    <div className="h-10 border-b border-surface-border bg-surface-raised flex items-center px-3 gap-3 shrink-0 text-[12px] overflow-x-auto">
      <span
        className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/40 bg-accent/10 text-accent shrink-0"
        title="Per-tab parameters — each session has its own snapshot"
      >
        tab params
      </span>
      <Slider
        label="Max side"
        value={params.maxSide}
        min={256}
        max={2048}
        step={64}
        suffix="px"
        onChange={(v) => onUpdate({ maxSide: v })}
      />
      <Slider
        label="Feature side"
        value={params.featureSide}
        min={128}
        max={512}
        step={16}
        suffix="px"
        onChange={(v) => onUpdate({ featureSide: v })}
      />
      <Toggle
        label="Pyramid"
        checked={params.pyramid}
        onChange={(v) => onUpdate({ pyramid: v })}
      />
      <Segmented
        label="Score"
        value={params.scoreMode}
        options={[
          { value: "sigmoid", label: "Sigmoid" },
          { value: "nll", label: "NLL" },
        ]}
        onChange={(v) => onUpdate({ scoreMode: v as "sigmoid" | "nll" })}
      />
      <button
        type="button"
        onClick={() => resetParams(sessionId)}
        className="text-[11px] px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface/60 flex items-center gap-1 shrink-0"
        title="Reset this tab's params to current globals"
      >
        <RotateCcw size={12} /> Reset
      </button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-text-muted shrink-0">
      <span className="whitespace-nowrap">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 accent-accent"
      />
      <span className="tabular-nums text-text w-14">
        {value}
        {suffix}
      </span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none shrink-0">
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
    <div className="flex items-center gap-1.5 text-[11px] text-text-muted shrink-0">
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
