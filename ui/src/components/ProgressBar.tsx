import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompareStatus } from "@/state/sessions";

interface Props {
  status: Extract<CompareStatus, { kind: "running" }>;
  className?: string;
}

/**
 * Inline progress strip shown next to the Cancel button while a stream is
 * live. Stays smooth during reconnects / state drops: if no stage event
 * has arrived yet we show an indeterminate spinner; once we have stages
 * the bar grows deterministically from 0..100%.
 */
export function ProgressBar({ status, className }: Props) {
  const stage = status.stage;
  const pct = stage ? Math.round((stage.index / stage.total) * 100) : null;

  return (
    <div
      className={cn(
        "flex-1 flex items-center gap-3 text-[11px] text-text-muted min-w-0",
        className,
      )}
    >
      <Loader2 size={13} className="shrink-0 animate-spin text-accent" />

      <div className="flex-1 min-w-0 max-w-md">
        <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-300 ease-out bg-accent",
              pct === null && "w-1/4 animate-pulse",
            )}
            style={pct !== null ? { width: `${pct}%` } : undefined}
          />
        </div>
      </div>

      <div className="shrink-0 tabular-nums whitespace-nowrap">
        {stage
          ? `${stage.index}/${stage.total} · ${stage.name}`
          : "Starting engine…"}
      </div>
    </div>
  );
}
