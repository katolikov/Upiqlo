import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { HEATMAP_LAYERS, type HeatmapLayer } from "@/state/sessions";

interface Props {
  value: HeatmapLayer;
  onChange: (layer: HeatmapLayer) => void;
  available: Set<string>;
}

/** Sub-tabs grouped by "semantic" / "structural" / "heuristic" algorithm layers. */
export function MiddlePaneTabs({ value, onChange, available }: Props) {
  const groups = useMemo(() => {
    const g: Record<string, typeof HEATMAP_LAYERS> = {
      semantic: [],
      structural: [],
      heuristic: [],
    };
    for (const item of HEATMAP_LAYERS) g[item.group].push(item);
    return g;
  }, []);

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 border-b border-surface-border bg-surface-raised text-xs">
      {(["semantic", "structural", "heuristic"] as const).map((group) => (
        <div key={group} className="flex items-center gap-1">
          <span className="uppercase tracking-wider text-[10px] text-text-faint mr-1">{group}</span>
          {groups[group].map((item) => {
            const disabled = available.size > 0 && !available.has(item.key);
            const active = value === item.key;
            return (
              <button
                key={item.key}
                type="button"
                disabled={disabled}
                onClick={() => onChange(item.key)}
                className={cn(
                  "px-2 py-1 rounded-md transition-colors border",
                  active
                    ? "bg-accent/15 text-accent border-accent/40"
                    : "bg-transparent text-text-muted border-transparent hover:bg-surface/60 hover:text-text",
                  disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-text-muted",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
