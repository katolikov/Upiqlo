import { cn } from "@/lib/utils";
import type { CompareReport } from "@/types/report";
import type { CompareStatus } from "@/state/sessions";
import { ProgressBar } from "./ProgressBar";

interface Props {
  report: CompareReport | null;
  status: CompareStatus["kind"];
  /** When the session is "running", pass its live status so the progress
   * bar can render inside this dashboard (replacing its empty state). */
  runningStatus?: Extract<CompareStatus, { kind: "running" }>;
}

const SEVERITY_LABELS: Record<string, string> = {
  blocking: "JPEG Blocking",
  ringing: "Gibbs Ringing",
  noise: "Gaussian Noise",
  color_shift: "Color Shift",
  blur: "Blur",
};

/**
 * Bottom results panel. During a live run it hosts the smooth progress
 * bar; after completion it renders score + dominant artifact + severity
 * bars + resolution.
 */
export function MetricsDashboard({ report, status, runningStatus }: Props) {
  if (status === "running" && runningStatus) {
    return (
      <div className="h-28 border-t border-surface-border bg-surface-raised flex items-center px-6">
        <ProgressBar status={runningStatus} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="h-28 border-t border-surface-border bg-surface-raised flex items-center justify-center text-xs text-text-faint">
        {status === "error"
          ? "Comparison failed — see workspace for details."
          : status === "cancelled"
            ? "Comparison cancelled. CPU freed."
            : "No comparison run yet."}
      </div>
    );
  }

  const sev = report.diagnostics.severity_scores;
  const score01 = Math.max(0, Math.min(1, report.score));

  return (
    <div className="h-28 border-t border-surface-border bg-surface-raised flex items-stretch animate-fade-in">
      <ScoreBlock score={score01} label={report.score_label} />
      <DominantBlock
        dominant={report.diagnostics.dominant_artifact}
        affected={report.diagnostics.affected_area}
      />
      <div
        className={`flex-1 grid gap-0 ${
          sev.blocking !== undefined ? "grid-cols-5" : "grid-cols-4"
        }`}
      >
        {(["blocking", "ringing", "noise", "color_shift", "blur"] as const)
          .filter((k) => sev[k] !== undefined)
          .map((k) => (
            <SeverityBlock key={k} name={SEVERITY_LABELS[k]} value={sev[k]!} />
          ))}
      </div>
      <ResolutionBlock
        width={report.image_resolution.width}
        height={report.image_resolution.height}
      />
    </div>
  );
}

function ScoreBlock({ score, label }: { score: number; label: string }) {
  const color =
    score >= 0.9
      ? "text-signal-success"
      : score >= 0.75
        ? "text-signal-success"
        : score >= 0.6
          ? "text-signal-warning"
          : score >= 0.45
            ? "text-signal-warning"
            : "text-signal-danger";
  return (
    <div className="w-40 px-4 py-2 flex flex-col justify-center border-r border-surface-border">
      <div className="text-[10px] uppercase tracking-wider text-text-faint">FR-IQA Score</div>
      <div className={cn("text-2xl font-semibold tabular-nums leading-none mt-1", color)}>
        {score.toFixed(3)}
      </div>
      <div className="text-[11px] text-text-muted mt-1">{label}</div>
    </div>
  );
}

function DominantBlock({ dominant, affected }: { dominant: string; affected: number }) {
  return (
    <div className="w-44 px-4 py-2 flex flex-col justify-center border-r border-surface-border">
      <div className="text-[10px] uppercase tracking-wider text-text-faint">Dominant Artifact</div>
      <div className="text-base font-medium leading-none mt-1">{dominant}</div>
      <div className="text-[11px] text-text-muted mt-1">
        {affected.toFixed(1)}% affected area
      </div>
    </div>
  );
}

function SeverityBlock({ name, value }: { name: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const bar =
    clamped >= 70
      ? "bg-signal-danger/80"
      : clamped >= 40
        ? "bg-signal-warning/70"
        : clamped >= 15
          ? "bg-signal-success/60"
          : "bg-signal-success/40";
  return (
    <div className="px-3 py-2 flex flex-col justify-center border-r border-surface-border last:border-r-0">
      <div className="text-[10px] uppercase tracking-wider text-text-faint truncate">{name}</div>
      <div className="text-base font-medium tabular-nums leading-none mt-1">
        {value.toFixed(1)}
      </div>
      <div className="h-1.5 mt-2 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", bar)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function ResolutionBlock({ width, height }: { width: number; height: number }) {
  return (
    <div className="w-36 px-4 py-2 flex flex-col justify-center">
      <div className="text-[10px] uppercase tracking-wider text-text-faint">Resolution</div>
      <div className="text-base font-medium tabular-nums leading-none mt-1">
        {width}×{height}
      </div>
      <div className="text-[11px] text-text-muted mt-1">pixels</div>
    </div>
  );
}
