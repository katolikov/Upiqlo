import { cn } from "@/lib/utils";
import { UNIFIED_LAYERS, type UnifiedArtifact } from "@/lib/unified-composite";

interface Props {
  enabled: Set<string>;
  onToggle: (key: UnifiedArtifact) => void;
  available: Set<string>;
}

/**
 * Pill-style toggles for the "Unified" composite view. Each pill flips
 * its corresponding artefact layer on/off instantly on the frontend —
 * no re-run of the algorithm.
 */
export function UnifiedToggles({ enabled, onToggle, available }: Props) {
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
                ? "border-transparent text-black"
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
              style={{ backgroundColor: isEnabled ? "#0f0c09" : layer.color }}
            />
            {layer.label}
          </button>
        );
      })}
    </div>
  );
}
