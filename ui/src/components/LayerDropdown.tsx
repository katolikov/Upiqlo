import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { HEATMAP_LAYERS, type HeatmapLayer } from "@/state/sessions";

interface Props {
  value: HeatmapLayer;
  onChange: (layer: HeatmapLayer) => void;
  /** When provided, unavailable layers are greyed out. */
  available?: Set<string>;
}

/**
 * Clickable text label above the middle pane that opens a dropdown of
 * every output layer. Picking a layer DOES NOT touch the viewport
 * transform — pan/zoom is preserved across switches (the viewport state
 * is per-session, not per-layer).
 */
export function LayerDropdown({ value, onChange, available }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const current = HEATMAP_LAYERS.find((l) => l.key === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted hover:text-text hover:bg-surface-raised text-[11px]"
      >
        <span className="text-[10px] uppercase tracking-wider text-text-faint">Output</span>
        <span className="font-medium text-text">{current?.label ?? value}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 min-w-[220px] rounded-md border border-surface-border bg-surface-raised shadow-lg py-1">
          {(["semantic", "structural", "heuristic"] as const).map((group) => (
            <div key={group}>
              <div className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-text-faint">
                {group}
              </div>
              {HEATMAP_LAYERS.filter((l) => l.group === group).map((l) => {
                const disabled = available && available.size > 0 && !available.has(l.key);
                const active = l.key === value;
                return (
                  <button
                    key={l.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onChange(l.key);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between",
                      active && "bg-accent/15 text-accent",
                      !active && !disabled && "hover:bg-surface text-text",
                      disabled && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    <span>{l.label}</span>
                    {active && <span className="text-[10px]">✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
