import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { HEATMAP_LAYERS, type HeatmapLayer } from "@/state/sessions";

interface Props {
  value: HeatmapLayer;
  onChange: (layer: HeatmapLayer) => void;
  available?: Set<string>;
}

/**
 * Single-click pill above the middle output pane: the label and the
 * dropdown trigger are fused into one element (no separate "Output:"
 * caption). Picking a layer never touches the viewport transform, so
 * pan/zoom survives the switch.
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
        className={cn(
          "px-3 py-1.5 rounded-md border border-surface-border bg-surface-raised/90 backdrop-blur",
          "text-[12px] text-text flex items-center gap-2 hover:bg-surface-hover hover:border-surface-border-strong",
          open && "border-accent/60 bg-accent/10",
        )}
        title="Change output layer"
      >
        <span className="font-medium">Output</span>
        <span className="text-text-faint">›</span>
        <span className="font-semibold text-accent">{current?.label ?? value}</span>
        <ChevronDown size={13} className={cn("text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-30 min-w-[240px] rounded-md border border-surface-border bg-surface-raised shadow-lg py-1">
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
