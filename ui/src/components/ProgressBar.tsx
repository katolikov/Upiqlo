import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CompareStatus } from "@/state/sessions";

interface Props {
  status: Extract<CompareStatus, { kind: "running" }>;
  className?: string;
  /** Optional: how many seconds we expect a full run to take. Used to
   * ease-fill the bar between stage events so it never looks frozen. */
  expectedSeconds?: number;
}

/**
 * Smoothly-animated progress bar.
 *
 * Stage events arrive at discrete moments (e.g. 1/5 then 3/5 then 5/5).
 * Naively tying the bar width to index/total makes it "jump". We
 * interpolate between successive stage events with ease-out, and during
 * stretches without new events we creep the bar toward the next stage
 * boundary using the `expectedSeconds` hint so the user sees motion.
 */
export function ProgressBar({
  status,
  className,
  expectedSeconds = 8,
}: Props) {
  const stage = status.stage;
  const target = stage ? Math.max(0, Math.min(1, stage.index / stage.total)) : 0;

  const [value, setValue] = useState(target);
  const prevTarget = useRef(target);
  const started = useRef(Date.now());

  useEffect(() => {
    let raf = 0;
    const animate = () => {
      setValue((cur) => {
        const runtime = (Date.now() - started.current) / 1000;
        let goal = target;
        if (stage) {
          const perStage = Math.max(0.5, expectedSeconds / stage.total);
          const inStageProgress = Math.min(1, (runtime % perStage) / perStage);
          const nextBoundary = Math.min(1, (stage.index + inStageProgress * 0.6) / stage.total);
          goal = Math.max(target, nextBoundary);
        }
        const delta = goal - cur;
        if (Math.abs(delta) < 0.0005) return cur;
        return cur + delta * 0.1;
      });
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [expectedSeconds, stage, target]);

  useEffect(() => {
    if (prevTarget.current !== target) {
      prevTarget.current = target;
      started.current = Date.now();
    }
  }, [target]);

  const pct = Math.round(value * 100);

  return (
    <div
      className={cn(
        "flex-1 flex items-center gap-3 text-[11px] text-text-muted min-w-0",
        className,
      )}
    >
      <Loader2 size={13} className="shrink-0 animate-spin text-accent" />

      <div className="flex-1 min-w-0">
        <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${pct}%` }}
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
