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
 * The Output pane's title IS the dropdown trigger. Clicking anywhere on
 * the pill opens the menu below. The pill stays at a higher z-index
 * than the pane content so it never gets covered.
 */
export function LayerDropdown({ value, onChange, available }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = HEATMAP_LAYERS.find((l) => l.key === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-md border transition-colors",
          "bg-surface-raised/95 backdrop-blur text-text",
          open ? "border-accent/60 bg-accent/10" : "border-surface-border hover:border-surface-border-strong hover:bg-surface-hover",
        )}
        title="Change output layer"
      >
        <span className="text-[10px] uppercase tracking-wider text-text-faint font-semibold">
          Output
        </span>
        <span className="text-text-faint">·</span>
        <span className="text-[12px] font-semibold text-accent">
          {current?.label ?? value}
        </span>
        <ChevronDown
          size={13}
          className={cn(
            "text-text-muted transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            "absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 min-w-[240px]",
            "rounded-md border border-surface-border bg-surface-raised shadow-lg py-1",
            "animate-dropdown-in origin-top",
          )}
        >
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
                      "w-full text-left px-3 py-1.5 text-[12px] flex items-center justify-between transition-colors",
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
