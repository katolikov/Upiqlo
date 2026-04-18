import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  FileImage,
  FolderOpen,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { scanFolders, heatmapDataUrl } from "@/lib/api";
import { streamCompare } from "@/lib/stream";
import { resolveImageSrc } from "@/lib/assets";
import { pickDirectory } from "@/lib/pickers";
import {
  BOX_COLORS,
  ClearAnnotationsButton,
  ColorPalette,
  ImageCanvas,
} from "@/components/ImageCanvas";
import { LayerDropdown } from "@/components/LayerDropdown";
import { MetricsDashboard } from "@/components/MetricsDashboard";
import { ProgressBar } from "@/components/ProgressBar";
import { SessionConfigBar } from "@/components/SessionConfigBar";
import { cn } from "@/lib/utils";
import {
  pairIdFor,
  useSessions,
  type BoundingBox,
  type FolderSession,
} from "@/state/sessions";
import type { FolderPair } from "@/types/folders";

interface Props {
  session: FolderSession;
}

export function FolderCompareMode({ session }: Props) {
  const setFolderDirs = useSessions((s) => s.setFolderDirs);
  const setFolderScan = useSessions((s) => s.setFolderScan);
  const setFolderActivePair = useSessions((s) => s.setFolderActivePair);
  const setFolderPairStatus = useSessions((s) => s.setFolderPairStatus);
  const renameSession = useSessions((s) => s.renameSession);
  const setLayer = useSessions((s) => s.setLayer);
  const addAnnotation = useSessions((s) => s.addAnnotation);
  const removeAnnotation = useSessions((s) => s.removeAnnotation);
  const clearAnnotations = useSessions((s) => s.clearAnnotations);

  const pair: FolderPair | null = useMemo(() => {
    if (!session.scan) return null;
    return session.scan.pairs[session.activePairIndex] ?? null;
  }, [session.scan, session.activePairIndex]);

  const pairStatus = pair ? session.results[pairIdFor(pair)] : null;
  const currentPairId = pair ? pairIdFor(pair) : undefined;
  const annotations = currentPairId ? session.annotationsByPair[currentPairId] ?? [] : [];

  const [refSrc, setRefSrc] = useState<string | null>(null);
  const [tgtSrc, setTgtSrc] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState<string>(BOX_COLORS[0]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([resolveImageSrc(pair?.reference_path ?? null), resolveImageSrc(pair?.target_path ?? null)])
      .then(([r, t]) => {
        if (cancelled) return;
        setRefSrc(r);
        setTgtSrc(t);
      });
    return () => {
      cancelled = true;
    };
  }, [pair?.reference_path, pair?.target_path]);

  const streamRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  useEffect(() => {
    return () => {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) void s.cancel();
    };
  }, []);
  useEffect(() => {
    const s = streamRef.current;
    if (!s) return;
    streamRef.current = null;
    void s.cancel();
  }, [session.activePairIndex]);

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

  const runPair = useCallback(() => {
    if (!pair) return;
    const pid = pairIdFor(pair);
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
  const report = pairStatus?.kind === "ok" ? pairStatus.report : null;
  const heatmapB64 = report?.heatmaps[session.layer] ?? null;
  const middleSrc = heatmapB64 ? heatmapDataUrl(heatmapB64) : null;
  const available = new Set(Object.keys(report?.heatmaps ?? {}));

  const middlePlaceholder = !pair
    ? "Scan two folders to get started"
    : pairStatus?.kind === "running"
      ? pairStatus.stage
        ? `Stage ${pairStatus.stage.index}/${pairStatus.stage.total} · ${pairStatus.stage.name}`
        : "Starting engine…"
      : pairStatus?.kind === "error"
        ? `Error: ${pairStatus.message}`
        : pairStatus?.kind === "cancelled"
          ? "Comparison cancelled. Click Compare pair to retry."
          : "Click Compare pair to run";

  const onAddBox = useCallback(
    (box: BoundingBox) => {
      if (currentPairId) addAnnotation(session.id, box, currentPairId);
    },
    [addAnnotation, currentPairId, session.id],
  );
  const onDeleteBox = useCallback(
    (id: string) => {
      if (currentPairId) removeAnnotation(session.id, id, currentPairId);
    },
    [currentPairId, removeAnnotation, session.id],
  );
  const onSaveImage = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <SessionConfigBar sessionId={session.id} params={session.params} />

      <div className="h-10 border-b border-surface-border bg-surface flex items-center px-3 gap-3 shrink-0 text-[12px]">
        <DirPicker label="A dir" value={session.referenceDir} onPick={pickRef} />
        <DirPicker label="B dir" value={session.targetDir} onPick={pickTgt} />
        <button
          type="button"
          onClick={runScan}
          disabled={!session.referenceDir || !session.targetDir}
          className="flex items-center gap-1 px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <RefreshCw size={12} /> Scan
        </button>

        <div className="h-5 w-px bg-surface-border" />

        <div className="text-[11px] text-text-muted tabular-nums shrink-0">
          {session.scan
            ? `${session.scan.pairs.length} pair${session.scan.pairs.length === 1 ? "" : "s"}`
            : "—"}
          {pair ? ` · ${session.activePairIndex + 1} / ${session.scan?.pairs.length ?? 0}` : ""}
        </div>

        {running && pairStatus?.kind === "running" ? (
          <ProgressBar status={pairStatus} />
        ) : (
          <div className="flex-1" />
        )}

        <ColorPalette value={drawColor} onChange={setDrawColor} />
        <ClearAnnotationsButton
          count={annotations.length}
          onClick={() => currentPairId && clearAnnotations(session.id, currentPairId)}
        />

        {running ? (
          <button
            type="button"
            onClick={cancelPair}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-signal-danger/50 bg-signal-danger/10 text-signal-danger text-[12px] font-medium hover:bg-signal-danger/20"
          >
            <XCircle size={13} /> Cancel
          </button>
        ) : (
          <button
            type="button"
            disabled={!hasPair}
            onClick={runPair}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent-hot disabled:bg-surface-sunken disabled:text-text-faint disabled:cursor-not-allowed"
          >
            <Play size={13} /> Compare pair
          </button>
        )}
      </div>

      <div className="flex-1 flex min-h-0 min-w-0">
        {/* Left-most: file explorer for folder A */}
        <FileExplorer
          side="A"
          scan={session.scan}
          activeIndex={session.activePairIndex}
          onPick={(i) => setFolderActivePair(session.id, i)}
          getPath={(p) => p.reference_path}
          className="border-r border-surface-border"
        />

        {/* Reference pane */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={session.id}
            src={refSrc}
            label="A · Reference"
            placeholder={pair ? "Loading…" : "Scan folders + pick a pair"}
            boxes={annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(pair?.reference_path) || "reference"}-annotated`}
          />
        </div>

        {/* Output pane */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border relative">
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">
            <LayerDropdown
              value={session.layer}
              onChange={(l) => setLayer(session.id, l)}
              available={available}
            />
          </div>
          <ImageCanvas
            sessionId={session.id}
            src={middleSrc}
            label={`Output · ${labelFor(session.layer)}`}
            placeholder={middlePlaceholder}
            drawable
            drawColor={drawColor}
            boxes={annotations}
            onDrawBox={onAddBox}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${labelFor(session.layer)}-annotated`}
          />
        </div>

        {/* Target pane */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={session.id}
            src={tgtSrc}
            label="B · Target"
            placeholder={pair ? "Loading…" : "Scan folders + pick a pair"}
            boxes={annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(pair?.target_path) || "target"}-annotated`}
          />
        </div>

        {/* Right-most: file explorer for folder B */}
        <FileExplorer
          side="B"
          scan={session.scan}
          activeIndex={session.activePairIndex}
          onPick={(i) => setFolderActivePair(session.id, i)}
          getPath={(p) => p.target_path}
        />
      </div>

      <MetricsDashboard report={report} status={pairStatus?.kind ?? "idle"} />
    </div>
  );
}

// -------------------------- File explorer column --------------------------

function FileExplorer({
  side,
  scan,
  activeIndex,
  onPick,
  getPath,
  className,
}: {
  side: "A" | "B";
  scan: FolderSession["scan"];
  activeIndex: number;
  onPick: (index: number) => void;
  getPath: (p: FolderPair) => string;
  className?: string;
}) {
  const label = side === "A" ? "Folder A" : "Folder B";
  const unmatched = scan
    ? side === "A"
      ? scan.unmatched_reference
      : scan.unmatched_target
    : [];

  return (
    <aside
      className={cn(
        "w-56 shrink-0 flex flex-col bg-surface-raised min-h-0",
        className,
      )}
    >
      <div className="h-8 shrink-0 px-3 flex items-center text-[11px] uppercase tracking-wider text-text-faint border-b border-surface-border">
        <FolderOpen size={11} className="mr-1.5" />
        {label}
      </div>

      {!scan ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center text-[11px] text-text-faint">
          (no scan yet)
        </div>
      ) : scan.pairs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center text-[11px] text-text-faint">
          (no pairs)
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto min-h-0">
          {scan.pairs.map((p, i) => {
            const active = i === activeIndex;
            const name = basename(getPath(p));
            return (
              <li key={p.label + i}>
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] border-l-2 transition-colors",
                    active
                      ? "bg-accent/15 text-accent border-accent"
                      : "text-text-muted border-transparent hover:bg-surface-hover/50 hover:text-text",
                  )}
                  title={getPath(p)}
                >
                  <FileImage size={11} className="shrink-0 text-text-faint" />
                  <span className="truncate">{name}</span>
                </button>
              </li>
            );
          })}
          {unmatched.length > 0 && (
            <>
              <li className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-faint flex items-center gap-1 border-t border-surface-border mt-1">
                <AlertCircle size={11} /> Unmatched ({unmatched.length})
              </li>
              {unmatched.map((p) => (
                <li key={p}>
                  <div
                    className="w-full text-left px-3 py-1 flex items-center gap-2 text-[11px] text-text-faint"
                    title={p}
                  >
                    <FileImage size={11} className="shrink-0 opacity-50" />
                    <span className="truncate italic">{basename(p)}</span>
                  </div>
                </li>
              ))}
            </>
          )}
        </ul>
      )}
    </aside>
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
      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised max-w-[240px] shrink-0"
      title={value ?? "Click to pick a folder"}
    >
      <FolderOpen size={12} />
      <span className="font-medium">{label}</span>
      <span className="truncate text-[11px]">{value ? basename(value) : "Pick folder…"}</span>
    </button>
  );
}

function basename(path: string | null | undefined): string {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function labelFor(layer: string): string {
  return (
    (
      [
        ["diagnostic_overlay.png", "Unified"],
        ["anomaly_highlight.png", "Anomaly Highlight"],
        ["anomaly_overlay.png", "Anomaly Overlay"],
        ["global_anomaly_map.png", "Anomaly Map"],
        ["structural_similarity_map.png", "Structure"],
        ["color_degradation_map.png", "Color"],
        ["gibbs_ringing_mask.png", "Ringing"],
        ["gaussian_noise_mask.png", "Noise"],
        ["blur_mask.png", "Blur"],
      ] as const
    ).find(([k]) => k === layer)?.[1] ?? layer
  );
}
