import { useCallback, useEffect, useRef } from "react";
import { FileImage, Play, XCircle } from "lucide-react";
import { pickImageFile } from "@/lib/pickers";
import { streamCompare } from "@/lib/stream";
import { Workspace3Pane } from "@/components/Workspace3Pane";
import { MetricsDashboard } from "@/components/MetricsDashboard";
import { ProgressBar } from "@/components/ProgressBar";
import { useSessions, type SingleSession } from "@/state/sessions";

interface Props {
  session: SingleSession;
}

export function SingleCompareMode({ session }: Props) {
  const setSinglePaths = useSessions((s) => s.setSinglePaths);
  const setSingleStatus = useSessions((s) => s.setSingleStatus);
  const renameSession = useSessions((s) => s.renameSession);

  // Track the active stream so we can cancel when:
  //   * the user clicks Cancel
  //   * the user kicks off a new comparison
  //   * the tab is closed / unmounted
  const streamRef = useRef<{ cancel: () => Promise<void> } | null>(null);

  // Auto-cancel on unmount (tab close or remount).
  useEffect(() => {
    return () => {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) void s.cancel();
    };
  }, []);

  const onPickRef = useCallback(async () => {
    const p = await pickImageFile("Select reference image (A)");
    if (p) {
      setSinglePaths(session.id, p, session.targetPath);
      if (session.title === "New Comparison") {
        renameSession(session.id, filename(p));
      }
    }
  }, [session.id, session.targetPath, session.title, setSinglePaths, renameSession]);

  const onPickTgt = useCallback(async () => {
    const p = await pickImageFile("Select target image (B)");
    if (p) setSinglePaths(session.id, session.referencePath, p);
  }, [session.id, session.referencePath, setSinglePaths]);

  const run = useCallback(() => {
    if (!session.referencePath || !session.targetPath) return;

    // Cancel any previous stream from this session.
    const prev = streamRef.current;
    streamRef.current = null;
    if (prev) void prev.cancel();

    setSingleStatus(session.id, { kind: "running", startedAt: Date.now() });
    const p = session.params;
    const handle = streamCompare(
      {
        reference_path: session.referencePath,
        target_path: session.targetPath,
        params: {
          max_side: p.maxSide,
          score_mode: p.scoreMode,
          pyramid: p.pyramid,
          feature_side: p.featureSide,
        },
      },
      (evt) => {
        if (streamRef.current !== handle) return; // stale callback
        switch (evt.type) {
          case "open":
            setSingleStatus(session.id, {
              kind: "running",
              startedAt: Date.now(),
              token: evt.token,
            });
            break;
          case "stage":
            setSingleStatus(session.id, (prev) => {
              if (prev.kind !== "running") return prev;
              return { ...prev, stage: evt.stage };
            });
            break;
          case "result":
            setSingleStatus(session.id, {
              kind: "ok",
              report: evt.report,
              finishedAt: Date.now(),
            });
            break;
          case "done":
            streamRef.current = null;
            break;
          case "cancelled":
            setSingleStatus(session.id, { kind: "cancelled" });
            streamRef.current = null;
            break;
          case "error":
            setSingleStatus(session.id, { kind: "error", message: evt.message });
            streamRef.current = null;
            break;
        }
      },
    );
    streamRef.current = handle;
  }, [session.id, session.referencePath, session.targetPath, session.params, setSingleStatus]);

  const cancel = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    if (s) void s.cancel();
    setSingleStatus(session.id, { kind: "cancelled" });
  }, [session.id, setSingleStatus]);

  const running = session.status.kind === "running";
  const canRun = !!session.referencePath && !!session.targetPath && !running;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-10 border-b border-surface-border bg-surface flex items-center px-3 gap-3 shrink-0 text-[12px]">
        <PathPicker label="A" value={session.referencePath} onPick={onPickRef} />
        <PathPicker label="B" value={session.targetPath} onPick={onPickTgt} />
        {session.status.kind === "running" ? (
          <ProgressBar status={session.status} />
        ) : (
          <div className="flex-1" />
        )}
        {running ? (
          <button
            type="button"
            onClick={cancel}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-signal-danger/50 bg-signal-danger/10 text-signal-danger text-[12px] font-medium hover:bg-signal-danger/20"
          >
            <XCircle size={13} />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            disabled={!canRun}
            onClick={run}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent-hot disabled:bg-surface-sunken disabled:text-text-faint disabled:cursor-not-allowed"
          >
            <Play size={13} />
            Compare
          </button>
        )}
      </div>

      <Workspace3Pane
        sessionId={session.id}
        referencePath={session.referencePath}
        targetPath={session.targetPath}
        status={session.status}
        layer={session.layer}
      />

      <MetricsDashboard
        report={session.status.kind === "ok" ? session.status.report : null}
        status={session.status.kind}
      />
    </div>
  );
}

function PathPicker({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string | null;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised max-w-[360px]"
      title={value ?? "Click to pick an image"}
    >
      <FileImage size={12} />
      <span className="font-medium">{label}</span>
      <span className="truncate text-[11px]">{value ? filename(value) : "Pick image…"}</span>
    </button>
  );
}

function filename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
