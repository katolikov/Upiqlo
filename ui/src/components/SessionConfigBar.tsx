import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessions } from "@/state/sessions";
import type { Preferences } from "@/state/preferences";
import {
  impliedPixelFormat,
  needsRawConfig,
  PIXEL_FORMATS,
  type PixelFormat,
} from "@/lib/image-formats";

interface Props {
  sessionId: string;
  params: Preferences;
  /** Path(s) currently selected for this session — used to decide whether
   * to reveal the RAW-config row (width / height / pixel_format). */
  activePaths?: (string | null | undefined)[];
  /** Right-aligned action slot on the top row (typically the Run /
   * Cancel button). */
  action?: React.ReactNode;
}

/**
 * Per-session configuration strip, rendered at the top of the active
 * session's workspace. Edits go into THIS session's params snapshot,
 * so two tabs open at once can run with different settings.
 *
 * For standard formats (PNG, JPG, TIFF, BMP, WebP, NPY) dimensions and
 * pixel layout come from the file itself — no extra config needed.
 * When the user selects a RAW file (.raw / .bin / .yuv / .nv21 / .nv12),
 * the RAW row appears automatically with the required fields.
 */
export function SessionConfigBar({ sessionId, params, activePaths, action }: Props) {
  const updateParams = useSessions((s) => s.updateParams);
  const resetParams = useSessions((s) => s.resetParams);

  const onUpdate = (patch: Partial<Preferences>) => updateParams(sessionId, patch);

  const rawPaths = (activePaths ?? []).filter((p) => p && needsRawConfig(p)) as string[];
  const showRaw = rawPaths.length > 0;
  const implied = rawPaths.map(impliedPixelFormat).find(Boolean) ?? null;

  return (
    <div className="border-b border-surface-border bg-surface-raised shrink-0">
      <div className="h-10 flex items-center px-3 gap-3 text-[12px] overflow-x-auto">
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
        {action && <div className="ml-auto shrink-0 flex items-center">{action}</div>}
      </div>

      {showRaw && (
        <div className="h-9 flex items-center px-3 gap-3 text-[12px] border-t border-surface-border bg-surface overflow-x-auto">
          <span
            className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-signal-warning/40 bg-signal-warning/10 text-signal-warning shrink-0"
            title="Raw byte-stream inputs — provide shape + pixel format"
          >
            raw
          </span>
          <NumberField
            label="Width"
            value={params.rawWidth ?? ""}
            placeholder="e.g. 1920"
            onCommit={(v) => onUpdate({ rawWidth: v })}
          />
          <NumberField
            label="Height"
            value={params.rawHeight ?? ""}
            placeholder="e.g. 1080"
            onCommit={(v) => onUpdate({ rawHeight: v })}
          />
          <PixelFormatSelect
            value={implied ?? params.rawPixelFormat ?? null}
            locked={implied !== null}
            onChange={(v) => onUpdate({ rawPixelFormat: v })}
          />
          <span className="text-[11px] text-text-faint whitespace-nowrap">
            {implied
              ? `format derived from .${rawPaths[0].split(".").pop()}`
              : "Required for .raw / .bin / .yuv files"}
          </span>
        </div>
      )}
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

function NumberField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: number | string;
  placeholder?: string;
  onCommit: (v: number | null) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-muted shrink-0">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        max={16384}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw) onCommit(null);
          else {
            const n = Number(raw);
            onCommit(Number.isFinite(n) && n > 0 ? Math.round(n) : null);
          }
        }}
        className="w-20 bg-surface-sunken border border-surface-border rounded px-1.5 py-0.5 text-text text-[12px] outline-none focus:border-accent/60"
      />
    </label>
  );
}

function PixelFormatSelect({
  value,
  onChange,
  locked,
}: {
  value: PixelFormat | null;
  onChange: (v: PixelFormat) => void;
  locked?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-text-muted shrink-0">
      <span>Pixel format</span>
      <select
        disabled={locked}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value as PixelFormat)}
        className={cn(
          "bg-surface-sunken border border-surface-border rounded px-1.5 py-0.5 text-text text-[12px] outline-none focus:border-accent/60",
          locked && "opacity-60 cursor-not-allowed",
        )}
      >
        <option value="">— pick —</option>
        {PIXEL_FORMATS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
}
