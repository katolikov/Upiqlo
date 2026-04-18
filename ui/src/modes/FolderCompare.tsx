import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileImage, Play, RotateCw, XCircle } from "lucide-react";
import { heatmapDataUrl, scanFolders } from "@/lib/api";
import { streamCompare } from "@/lib/stream";
import { resolveImageSrc } from "@/lib/assets";
import {
  buildUnified,
  UNIFIED_LAYERS,
  type UnifiedArtifact,
} from "@/lib/unified-composite";
import {
  BOX_COLORS,
  ClearAnnotationsButton,
  ColorPalette,
  ImageCanvas,
} from "@/components/ImageCanvas";
import { LayerDropdown } from "@/components/LayerDropdown";
import { MetricsDashboard } from "@/components/MetricsDashboard";
import { SessionConfigBar } from "@/components/SessionConfigBar";
import { SessionHeader } from "@/components/SessionHeader";
import { UnifiedToggles } from "@/components/UnifiedToggles";
import { cn } from "@/lib/utils";
import { toast } from "@/state/toast";
import {
  folderPairKey,
  useSessions,
  type BoundingBox,
  type FolderSession,
} from "@/state/sessions";
import type { FolderScanResponse } from "@/types/folders";

interface Props {
  session: FolderSession;
}

const DEFAULT_TOGGLES: UnifiedArtifact[] = UNIFIED_LAYERS.map((l) => l.key);

/**
 * Folder comparison mode. Layout:
 *
 *   [ config bar ................................... | Run / Cancel ]
 *   [ Left folder path | counts + tools | Right folder path         ]
 *   [ A explorer | Left canvas | Output canvas | Right canvas | B   ]
 *   [ metrics dashboard (progress when running)                     ]
 */
export function FolderCompareMode({ session }: Props) {
  const setFolderDirs = useSessions((s) => s.setFolderDirs);
  const setFolderScan = useSessions((s) => s.setFolderScan);
  const setFolderActiveRef = useSessions((s) => s.setFolderActiveRef);
  const setFolderActiveTgt = useSessions((s) => s.setFolderActiveTgt);
  const setFolderPairStatus = useSessions((s) => s.setFolderPairStatus);
  const setLayer = useSessions((s) => s.setLayer);
  const addAnnotation = useSessions((s) => s.addAnnotation);
  const removeAnnotation = useSessions((s) => s.removeAnnotation);
  const clearAnnotations = useSessions((s) => s.clearAnnotations);

  const [refSrc, setRefSrc] = useState<string | null>(null);
  const [tgtSrc, setTgtSrc] = useState<string | null>(null);
  const [drawColor, setDrawColor] = useState<string>(BOX_COLORS[0]);
  const [unifiedToggled, setUnifiedToggled] = useState<Set<string>>(
    () => new Set(DEFAULT_TOGGLES),
  );
  const [unifiedComposite, setUnifiedComposite] = useState<string | null>(null);
  const [unifiedBuilding, setUnifiedBuilding] = useState(false);

  const currentPairId = useMemo(
    () =>
      session.activeReferencePath && session.activeTargetPath
        ? folderPairKey(session.activeReferencePath, session.activeTargetPath)
        : null,
    [session.activeReferencePath, session.activeTargetPath],
  );

  const pairStatus = currentPairId ? session.results[currentPairId] : null;
  const annotations = currentPairId ? session.annotationsByPair[currentPairId] ?? [] : [];

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      resolveImageSrc(session.activeReferencePath),
      resolveImageSrc(session.activeTargetPath),
    ]).then(([r, t]) => {
      if (cancelled) return;
      setRefSrc(r);
      setTgtSrc(t);
    });
    return () => {
      cancelled = true;
    };
  }, [session.activeReferencePath, session.activeTargetPath]);

  useEffect(() => {
    if (!session.referenceDir || !session.targetDir) return;
    let cancelled = false;
    void scanFolders(session.referenceDir, session.targetDir, "filename")
      .then((scan) => {
        if (cancelled) return;
        setFolderScan(session.id, scan);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("scan failed", e);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.referenceDir, session.targetDir, setFolderScan]);

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
  }, [currentPairId]);

  const onCommitADir = useCallback(
    (p: string) => setFolderDirs(session.id, p, session.targetDir),
    [setFolderDirs, session.id, session.targetDir],
  );
  const onCommitBDir = useCallback(
    (p: string) => setFolderDirs(session.id, session.referenceDir, p),
    [setFolderDirs, session.id, session.referenceDir],
  );

  const runPair = useCallback(() => {
    if (!session.activeReferencePath || !session.activeTargetPath || !currentPairId) return;
    const prev = streamRef.current;
    streamRef.current = null;
    if (prev) void prev.cancel();

    setFolderPairStatus(session.id, currentPairId, { kind: "running", startedAt: Date.now() });
    const p = session.params;
    const handle = streamCompare(
      {
        reference_path: session.activeReferencePath,
        target_path: session.activeTargetPath,
        session_id: session.id,
        pair_id: currentPairId,
        params: {
          max_side: p.maxSide,
          score_mode: p.scoreMode,
          pyramid: p.pyramid,
          feature_side: p.featureSide,
          width: p.rawWidth ?? null,
          height: p.rawHeight ?? null,
          pixel_format: p.rawPixelFormat ?? null,
        },
      },
      (evt) => {
        if (streamRef.current !== handle) return;
        switch (evt.type) {
          case "open":
            setFolderPairStatus(session.id, currentPairId, {
              kind: "running",
              startedAt: Date.now(),
              token: evt.token,
            });
            break;
          case "stage":
            setFolderPairStatus(session.id, currentPairId, (prev) =>
              prev.kind === "running" ? { ...prev, stage: evt.stage } : prev,
            );
            break;
          case "result":
            setFolderPairStatus(session.id, currentPairId, {
              kind: "ok",
              report: evt.report,
              finishedAt: Date.now(),
            });
            break;
          case "done":
            streamRef.current = null;
            break;
          case "cancelled":
            setFolderPairStatus(session.id, currentPairId, { kind: "cancelled" });
            streamRef.current = null;
            break;
          case "error":
            setFolderPairStatus(session.id, currentPairId, {
              kind: "error",
              message: evt.message,
            });
            toast("error", `Run failed: ${evt.message}`);
            streamRef.current = null;
            break;
        }
      },
    );
    streamRef.current = handle;
  }, [currentPairId, session.activeReferencePath, session.activeTargetPath, session.id, session.params, setFolderPairStatus]);

  const cancelPair = useCallback(() => {
    if (!currentPairId) return;
    const s = streamRef.current;
    streamRef.current = null;
    if (s) void s.cancel();
    setFolderPairStatus(session.id, currentPairId, { kind: "cancelled" });
  }, [currentPairId, session.id, setFolderPairStatus]);

  const running = pairStatus?.kind === "running";
  const canRun = !!(session.activeReferencePath && session.activeTargetPath) && !running;
  const report = pairStatus?.kind === "ok" ? pairStatus.report : null;
  const available = useMemo(
    () => new Set(Object.keys(report?.heatmaps ?? {})),
    [report],
  );

  const toggledKey = useMemo(
    () => [...unifiedToggled].sort().join("|"),
    [unifiedToggled],
  );
  useEffect(() => {
    if (session.layer !== "diagnostic_overlay.png" || !report || !tgtSrc) {
      setUnifiedComposite(null);
      return;
    }
    let cancelled = false;
    setUnifiedBuilding(true);
    buildUnified({
      targetSrc: tgtSrc,
      heatmaps: report.heatmaps,
      enabled: unifiedToggled,
    })
      .then((url) => {
        if (!cancelled) setUnifiedComposite(url);
      })
      .finally(() => {
        if (!cancelled) setUnifiedBuilding(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.layer, report, tgtSrc, toggledKey]);

  useEffect(() => {
    if (!report) return;
    setUnifiedToggled((prev) => {
      const keep = new Set<string>();
      for (const k of prev) if (available.has(k)) keep.add(k);
      if (keep.size === 0) {
        for (const spec of UNIFIED_LAYERS) if (available.has(spec.key)) keep.add(spec.key);
      }
      return keep;
    });
  }, [available, report]);

  let middleSrc: string | null = null;
  if (session.layer === "diagnostic_overlay.png") {
    middleSrc = unifiedComposite;
  } else {
    const b64 = report?.heatmaps[session.layer] ?? null;
    middleSrc = b64 ? heatmapDataUrl(b64) : null;
  }

  const middlePlaceholder = !session.activeReferencePath || !session.activeTargetPath
    ? "Pick a file on each side"
    : pairStatus?.kind === "running"
      ? pairStatus.stage
        ? `Stage ${pairStatus.stage.index}/${pairStatus.stage.total} · ${pairStatus.stage.name}`
        : "Starting engine…"
      : pairStatus?.kind === "error"
        ? `Error: ${pairStatus.message}`
        : pairStatus?.kind === "cancelled"
          ? "Comparison cancelled. Click Run to retry."
          : session.layer === "diagnostic_overlay.png" && report && unifiedBuilding
            ? "Compositing unified view…"
            : "Click Run to compare this pair";

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
  const onSaveImage = useCallback(
    (blob: Blob, filename: string, writtenPath?: string) => {
      if (writtenPath) {
        toast("success", `Saved to ${writtenPath}`);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast("success", `Saved ${filename}`);
    },
    [],
  );

  const toggleLayer = useCallback((key: UnifiedArtifact) => {
    setUnifiedToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const { referenceFiles, targetFiles } = useMemo(
    () => explodeFileLists(session.scan),
    [session.scan],
  );

  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    if (reloadNonce === 0) return;
    let cancelled = false;
    Promise.all([
      resolveImageSrc(session.activeReferencePath),
      resolveImageSrc(session.activeTargetPath),
    ]).then(([r, t]) => {
      if (cancelled) return;
      setRefSrc(r ? `${r}${r.includes("?") ? "&" : "?"}_r=${reloadNonce}` : null);
      setTgtSrc(t ? `${t}${t.includes("?") ? "&" : "?"}_r=${reloadNonce}` : null);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, session.activeReferencePath, session.activeTargetPath]);

  const reload = useCallback(() => {
    setReloadNonce(Date.now());
    if (session.activeReferencePath && session.activeTargetPath && !running) runPair();
  }, [runPair, running, session.activeReferencePath, session.activeTargetPath]);

  const actionCluster = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={reload}
        disabled={!session.activeReferencePath || !session.activeTargetPath || running}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-[12px] transition-colors"
        title="Reload input images and re-run this pair"
      >
        <RotateCw size={12} /> Reload
      </button>
      {running ? (
        <button
          type="button"
          onClick={cancelPair}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-signal-danger/50 bg-signal-danger/10 text-signal-danger text-[12px] font-medium hover:bg-signal-danger/20 transition-colors"
        >
          <XCircle size={13} /> Cancel
        </button>
      ) : (
        <button
          type="button"
          disabled={!canRun}
          onClick={runPair}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent-hot disabled:bg-surface-sunken disabled:text-text-faint disabled:cursor-not-allowed transition-colors"
        >
          <Play size={13} /> Run
        </button>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <SessionConfigBar
        sessionId={session.id}
        params={session.params}
        activePaths={[session.activeReferencePath, session.activeTargetPath]}
        action={actionCluster}
      />

      <SessionHeader
        kind="directory"
        leftLabel="L"
        rightLabel="R"
        leftValue={session.referenceDir}
        onCommitLeft={onCommitADir}
        rightValue={session.targetDir}
        onCommitRight={onCommitBDir}
        middle={
          <div className="flex items-center gap-3 w-full justify-center">
            {session.scan && (
              <div className="text-[11px] text-text-muted tabular-nums shrink-0">
                {referenceFiles.length} · {targetFiles.length}
              </div>
            )}
            <ColorPalette value={drawColor} onChange={setDrawColor} />
            <ClearAnnotationsButton
              count={annotations.length}
              onClick={() => currentPairId && clearAnnotations(session.id, currentPairId)}
            />
          </div>
        }
      />

      <div className="flex-1 flex min-h-0 min-w-0">
        <FileList
          label="Folder A"
          files={referenceFiles}
          active={session.activeReferencePath}
          onPick={(p) => setFolderActiveRef(session.id, p)}
          className="border-r border-surface-border"
        />

        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={session.id}
            src={refSrc}
            label="L"
            placeholder="Pick a file in Folder A on the left"
            boxes={annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(session.activeReferencePath) || "reference"}-annotated`}
            sourcePath={session.activeReferencePath}
            footerReport={report}
          />
        </div>

        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border relative">
          <ImageCanvas
            sessionId={session.id}
            src={middleSrc}
            headerSlot={
              <LayerDropdown
                value={session.layer}
                onChange={(l) => setLayer(session.id, l)}
                available={available}
              />
            }
            placeholder={middlePlaceholder}
            drawable
            drawColor={drawColor}
            boxes={annotations}
            onDrawBox={onAddBox}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${labelFor(session.layer)}-annotated`}
            sourcePath={session.activeTargetPath}
            saveVariant={layerSlug(session.layer)}
            footerReport={report}
          />
          {session.layer === "diagnostic_overlay.png" && report && (
            <div className="absolute top-12 left-2 z-10 pointer-events-auto">
              <UnifiedToggles
                enabled={unifiedToggled}
                onToggle={toggleLayer}
                available={available}
                orientation="vertical"
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={session.id}
            src={tgtSrc}
            label="R"
            placeholder="Pick a file in Folder B on the right"
            boxes={annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(session.activeTargetPath) || "target"}-annotated`}
            sourcePath={session.activeTargetPath}
            footerReport={report}
          />
        </div>

        <FileList
          label="Folder B"
          files={targetFiles}
          active={session.activeTargetPath}
          onPick={(p) => setFolderActiveTgt(session.id, p)}
        />
      </div>

      <MetricsDashboard
        report={report}
        status={pairStatus?.kind ?? "idle"}
        runningStatus={pairStatus?.kind === "running" ? pairStatus : undefined}
      />
    </div>
  );
}

function FileList({
  label,
  files,
  active,
  onPick,
  className,
}: {
  label: string;
  files: string[];
  active: string | null;
  onPick: (path: string) => void;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "w-56 shrink-0 flex flex-col bg-surface-raised min-h-0",
        className,
      )}
    >
      <div className="h-8 shrink-0 px-3 flex items-center text-[11px] uppercase tracking-wider text-text-faint border-b border-surface-border">
        {label}
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center text-[11px] text-text-faint">
          (no files)
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto min-h-0">
          {files.map((p) => {
            const activeRow = active === p;
            return (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => onPick(p)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] border-l-2 transition-colors",
                    activeRow
                      ? "bg-accent/15 text-accent border-accent"
                      : "text-text-muted border-transparent hover:bg-surface-hover/50 hover:text-text",
                  )}
                  title={p}
                >
                  <FileImage size={11} className="shrink-0 text-text-faint" />
                  <span className="truncate">{basename(p)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function explodeFileLists(scan: FolderScanResponse | null): {
  referenceFiles: string[];
  targetFiles: string[];
} {
  if (!scan) return { referenceFiles: [], targetFiles: [] };
  const ref = [
    ...scan.pairs.map((p) => p.reference_path),
    ...scan.unmatched_reference,
  ];
  const tgt = [
    ...scan.pairs.map((p) => p.target_path),
    ...scan.unmatched_target,
  ];
  return {
    referenceFiles: Array.from(new Set(ref)).sort(cmpByBasename),
    targetFiles: Array.from(new Set(tgt)).sort(cmpByBasename),
  };
}

function cmpByBasename(a: string, b: string): number {
  return basename(a).toLowerCase().localeCompare(basename(b).toLowerCase());
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

function layerSlug(layer: string): string {
  return labelFor(layer).toLowerCase().replace(/\s+/g, "_");
}
