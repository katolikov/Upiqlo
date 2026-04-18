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
 * Each row/chip shows a persistent colour swatch and label so the user
 * can always see which hue corresponds to which artefact. Clicking a
 * chip toggles that layer; disabled chips are dimmed.
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
        {UNIFIED_LAYERS.map((layer) => (
          <Chip
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

  return (
    <div className="flex flex-col items-start gap-1">
      {UNIFIED_LAYERS.map((layer) => (
        <Chip
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

function Chip({
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
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1.5 h-6 px-2 rounded border text-[11px] font-medium transition-colors whitespace-nowrap",
        available
          ? enabled
            ? "bg-surface-raised/95 border-surface-border-strong text-text"
            : "bg-surface-raised/70 border-surface-border text-text-muted hover:text-text hover:bg-surface-hover"
          : "bg-surface-raised/40 border-surface-border text-text-faint cursor-not-allowed",
        !enabled && available && "opacity-70",
      )}
      title={
        available
          ? `${enabled ? "Hide" : "Show"} ${layer.label}`
          : `${layer.label} (not available in this run)`
      }
    >
      <span
        className={cn(
          "w-3 h-3 rounded-sm shrink-0 border transition-opacity",
          enabled ? "border-white/50" : "border-black/20 opacity-40",
        )}
        style={{ backgroundColor: layer.color }}
      />
      <span>{layer.label}</span>
    </button>
  );
}
