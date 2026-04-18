import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, FolderOpen, Play, RefreshCw, XCircle } from "lucide-react";
import { scanFolders } from "@/lib/api";
import { streamCompare } from "@/lib/stream";
import { pickDirectory } from "@/lib/pickers";
import { Workspace3Pane } from "@/components/Workspace3Pane";
import { MetricsDashboard } from "@/components/MetricsDashboard";
import { ProgressBar } from "@/components/ProgressBar";
import {
  pairIdFor,
  useSessions,
  type FolderSession,
} from "@/state/sessions";

interface Props {
  session: FolderSession;
}

export function FolderCompareMode({ session }: Props) {
  const setFolderDirs = useSessions((s) => s.setFolderDirs);
  const setFolderScan = useSessions((s) => s.setFolderScan);
  const setFolderActivePair = useSessions((s) => s.setFolderActivePair);
  const setFolderPairStatus = useSessions((s) => s.setFolderPairStatus);
  const renameSession = useSessions((s) => s.renameSession);

  const pair = useMemo(() => {
    if (!session.scan) return null;
    return session.scan.pairs[session.activePairIndex] ?? null;
  }, [session.scan, session.activePairIndex]);

  const pairStatus = pair ? session.results[pairIdFor(pair)] : null;

  const pickRef = useCallback(async () => {
    const p = await pickDirectory("Select reference folder (A)");
    if (p) {
      setFolderDirs(session.id, p, session.targetDir);
      if (session.title === "New Folder Compare") renameSession(session.id, basename(p));
    }
  }, [session.id, session.targetDir, session.title, setFolderDirs, renameSession]);

  const pickTgt = useCallback(async () => {
    const p = await pickDirectory("Select target folder (B)");
    if (p) setFolderDirs(session.id, session.referenceDir, p);
  }, [session.id, session.referenceDir, setFolderDirs]);

  const runScan = useCallback(async () => {
    if (!session.referenceDir || !session.targetDir) return;
    try {
      const scan = await scanFolders(session.referenceDir, session.targetDir, "filename");
      setFolderScan(session.id, scan);
    } catch (e) {
      console.error("scan failed", e);
      alert(`Folder scan failed: ${(e as Error).message}`);
    }
  }, [session.id, session.referenceDir, session.targetDir, setFolderScan]);

  // Track the current streamed run so we can cancel on tab close / pair
  // switch / explicit Cancel click.
  const streamRef = useRef<{ cancel: () => Promise<void> } | null>(null);

  // Cancel the running pair whenever we unmount or the user navigates to
  // a different pair within this folder session.
  useEffect(() => {
    return () => {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) void s.cancel();
    };
  }, []);

  // Pair change: kill whatever was running, leave the pair's state intact.
  useEffect(() => {
    const s = streamRef.current;
    if (!s) return;
    streamRef.current = null;
    void s.cancel();
  }, [session.activePairIndex]);

  const runPair = useCallback(() => {
    if (!pair) return;
    const pid = pairIdFor(pair);

    // Cancel any previous stream for this session before starting a new one.
    const prev = streamRef.current;
    streamRef.current = null;
    if (prev) void prev.cancel();

    setFolderPairStatus(session.id, pid, { kind: "running", startedAt: Date.now() });
    const p = session.params;
    const handle = streamCompare(
      {
        reference_path: pair.reference_path,
        target_path: pair.target_path,
        session_id: session.id,
        pair_id: pid,
        params: {
          max_side: p.maxSide,
          score_mode: p.scoreMode,
          pyramid: p.pyramid,
          feature_side: p.featureSide,
        },
      },
      (evt) => {
        if (streamRef.current !== handle) return;
        switch (evt.type) {
          case "open":
            setFolderPairStatus(session.id, pid, {
              kind: "running",
              startedAt: Date.now(),
              token: evt.token,
            });
            break;
          case "stage":
            setFolderPairStatus(session.id, pid, (prev) =>
              prev.kind === "running" ? { ...prev, stage: evt.stage } : prev,
            );
            break;
          case "result":
            setFolderPairStatus(session.id, pid, {
              kind: "ok",
              report: evt.report,
              finishedAt: Date.now(),
            });
            break;
          case "done":
            streamRef.current = null;
            break;
          case "cancelled":
            setFolderPairStatus(session.id, pid, { kind: "cancelled" });
            streamRef.current = null;
            break;
          case "error":
            setFolderPairStatus(session.id, pid, {
              kind: "error",
              message: evt.message,
            });
            streamRef.current = null;
            break;
        }
      },
    );
    streamRef.current = handle;
  }, [pair, session.id, session.params, setFolderPairStatus]);

  const cancelPair = useCallback(() => {
    if (!pair) return;
    const pid = pairIdFor(pair);
    const s = streamRef.current;
    streamRef.current = null;
    if (s) void s.cancel();
    setFolderPairStatus(session.id, pid, { kind: "cancelled" });
  }, [pair, session.id, setFolderPairStatus]);

  const running = pairStatus?.kind === "running";
  const hasPair = !!pair;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-10 border-b border-surface-border bg-surface flex items-center px-3 gap-3 shrink-0 text-[12px]">
        <DirPicker label="A dir" value={session.referenceDir} onPick={pickRef} />
        <DirPicker label="B dir" value={session.targetDir} onPick={pickTgt} />
        <button
          type="button"
          onClick={runScan}
          disabled={!session.referenceDir || !session.targetDir}
          className="flex items-center gap-1 px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} />
          Scan
        </button>

        <div className="h-5 w-px bg-surface-border" />

        <PairNav session={session} onChange={(i) => setFolderActivePair(session.id, i)} />

        {running && pairStatus?.kind === "running" ? (
          <ProgressBar status={pairStatus} />
        ) : (
          <div className="flex-1" />
        )}

        {running ? (
          <button
            type="button"
            onClick={cancelPair}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-signal-danger/50 bg-signal-danger/10 text-signal-danger text-[12px] font-medium hover:bg-signal-danger/20"
          >
            <XCircle size={13} />
            Cancel
          </button>
        ) : (
          <button
            type="button"
            disabled={!hasPair}
            onClick={runPair}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent-hot disabled:bg-surface-sunken disabled:text-text-faint disabled:cursor-not-allowed"
          >
            <Play size={13} />
            Compare pair
          </button>
        )}
      </div>

      <Workspace3Pane
        sessionId={session.id}
        referencePath={pair?.reference_path ?? null}
        targetPath={pair?.target_path ?? null}
        status={pairStatus ?? { kind: "idle" }}
        layer={session.layer}
      />

      <MetricsDashboard
        report={pairStatus?.kind === "ok" ? pairStatus.report : null}
        status={pairStatus?.kind ?? "idle"}
      />
    </div>
  );
}

function DirPicker({
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
      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised max-w-[320px]"
      title={value ?? "Click to pick a folder"}
    >
      <FolderOpen size={12} />
      <span className="font-medium">{label}</span>
      <span className="truncate text-[11px]">{value ? basename(value) : "Pick folder…"}</span>
    </button>
  );
}

function PairNav({
  session,
  onChange,
}: {
  session: FolderSession;
  onChange: (index: number) => void;
}) {
  const n = session.scan?.pairs.length ?? 0;
  const i = session.activePairIndex;
  const current = session.scan?.pairs[i] ?? null;

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={n === 0 || i <= 0}
        onClick={() => onChange(i - 1)}
        className="p-1 rounded hover:bg-surface-raised text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronLeft size={14} />
      </button>
      <div className="text-[11px] text-text-muted tabular-nums min-w-[110px] text-center">
        {n === 0
          ? "No pairs scanned"
          : `${i + 1} / ${n}${current ? ` · ${current.label}` : ""}`}
      </div>
      <button
        type="button"
        disabled={n === 0 || i >= n - 1}
        onClick={() => onChange(i + 1)}
        className="p-1 rounded hover:bg-surface-raised text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
