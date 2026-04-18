import { useState } from "react";
import { cn } from "@/lib/utils";
import { UNIFIED_LAYERS, type UnifiedArtifact } from "@/lib/unified-composite";

interface Props {
  enabled: Set<string>;
  onToggle: (key: UnifiedArtifact) => void;
  available: Set<string>;
  orientation?: "horizontal" | "vertical";
}

/**
 * Per-artefact visibility toggles for the "Unified" composite view.
 *
 * In the vertical orientation (default for the output pane) each row is
 * a small colour square; hovering or focusing a square expands it to a
 * full pill with the layer's label.
 */
export function UnifiedToggles({
  enabled,
  onToggle,
  available,
  orientation = "vertical",
}: Props) {
  if (orientation === "horizontal") {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {UNIFIED_LAYERS.map((layer) => {
          const isEnabled = enabled.has(layer.key);
          const isAvailable = available.has(layer.key);
          return (
            <button
              key={layer.key}
              type="button"
              disabled={!isAvailable}
              onClick={() => onToggle(layer.key)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-medium transition-colors",
                isEnabled
                  ? "border-transparent text-white"
                  : "border-surface-border bg-surface-raised text-text-muted hover:text-text hover:bg-surface-hover",
                !isAvailable && "opacity-30 cursor-not-allowed",
              )}
              style={isEnabled ? { backgroundColor: layer.color, borderColor: layer.color } : undefined}
              title={
                isAvailable
                  ? `${isEnabled ? "Hide" : "Show"} ${layer.label} layer`
                  : `${layer.label} (not available in this run)`
              }
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: isEnabled ? "#ffffff" : layer.color }}
              />
              {layer.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {UNIFIED_LAYERS.map((layer) => (
        <VerticalLegendRow
          key={layer.key}
          layer={layer}
          enabled={enabled.has(layer.key)}
          available={available.has(layer.key)}
          onToggle={() => onToggle(layer.key)}
        />
      ))}
    </div>
  );
}

function VerticalLegendRow({
  layer,
  enabled,
  available,
  onToggle,
}: {
  layer: (typeof UNIFIED_LAYERS)[number];
  enabled: boolean;
  available: boolean;
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  const expanded = hover;

  return (
    <button
      type="button"
      disabled={!available}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={cn(
        "flex items-center gap-2 h-6 rounded border overflow-hidden transition-all duration-150 ease-out",
        expanded ? "w-[140px] px-1.5 bg-surface-raised/95 border-surface-border-strong" : "w-6 px-0 border-transparent",
        !available && "opacity-30 cursor-not-allowed",
      )}
      title={`${enabled ? "Hide" : "Show"} ${layer.label}`}
    >
      <span
        className={cn(
          "w-4 h-4 rounded shrink-0 border transition-transform duration-150",
          enabled ? "border-white/70" : "border-white/15",
          enabled ? "scale-100" : "scale-90 opacity-60",
        )}
        style={{ backgroundColor: layer.color }}
      />
      <span
        className={cn(
          "truncate text-[11px] font-medium transition-opacity duration-150",
          expanded ? "opacity-100 text-text" : "opacity-0",
        )}
      >
        {layer.label}
      </span>
    </button>
  );
}
