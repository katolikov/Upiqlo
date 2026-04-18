import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Play, RotateCw, XCircle } from "lucide-react";
import { streamCompare } from "@/lib/stream";
import { heatmapDataUrl } from "@/lib/api";
import { resolveImageSrc } from "@/lib/assets";
import { saveCombinedImage } from "@/lib/save-combined";
import { onTauriFileDrop } from "@/lib/tauri-drag";
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
import { toast } from "@/state/toast";
import {
  useSessions,
  type BoundingBox,
  type SingleSession,
} from "@/state/sessions";

interface Props {
  session: SingleSession;
}

const DEFAULT_TOGGLES: UnifiedArtifact[] = UNIFIED_LAYERS.map((l) => l.key);

/**
 * Single-image comparison mode. Layout:
 *
 *   [ config bar .................... | Run / Cancel ]
 *   [ Left path | annotation tools | Right path     ]
 *   [ Left pane | Output pane (hdr+legend) | Right  ]
 *   [ metrics dashboard (progress when running)     ]
 */
export function SingleCompareMode({ session }: Props) {
  const setSinglePaths = useSessions((s) => s.setSinglePaths);
  const setSingleStatus = useSessions((s) => s.setSingleStatus);
  const renameSession = useSessions((s) => s.renameSession);
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

  const streamRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  useEffect(() => {
    return () => {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) void s.cancel();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([resolveImageSrc(session.referencePath), resolveImageSrc(session.targetPath)])
      .then(([r, t]) => {
        if (cancelled) return;
        setRefSrc(r);
        setTgtSrc(t);
      });
    return () => {
      cancelled = true;
    };
  }, [session.referencePath, session.targetPath]);

  useEffect(() => {
    const off = onTauriFileDrop((paths) => {
      if (paths.length === 0) return;
      const current = useSessions.getState().sessions.find((s) => s.id === session.id);
      if (!current || current.mode !== "single") return;
      const [p0, p1] = paths;
      if (!current.referencePath) {
        setSinglePaths(session.id, p0, p1 ?? current.targetPath);
      } else if (!current.targetPath) {
        setSinglePaths(session.id, current.referencePath, p0);
      } else {
        setSinglePaths(session.id, p0, p1 ?? current.targetPath);
      }
    });
    return off;
  }, [session.id, setSinglePaths]);

  const onCommitA = useCallback(
    (p: string) => setSinglePaths(session.id, p, session.targetPath),
    [setSinglePaths, session.id, session.targetPath],
  );
  const onCommitB = useCallback(
    (p: string) => setSinglePaths(session.id, session.referencePath, p),
    [setSinglePaths, session.id, session.referencePath],
  );

  const run = useCallback(() => {
    if (!session.referencePath || !session.targetPath) return;
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
          width: p.rawWidth ?? null,
          height: p.rawHeight ?? null,
          pixel_format: p.rawPixelFormat ?? null,
        },
      },
      (evt) => {
        if (streamRef.current !== handle) return;
        switch (evt.type) {
          case "open":
            setSingleStatus(session.id, {
              kind: "running",
              startedAt: Date.now(),
              token: evt.token,
            });
            break;
          case "stage":
            setSingleStatus(session.id, (prev) =>
              prev.kind === "running" ? { ...prev, stage: evt.stage } : prev,
            );
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
            toast("error", `Run failed: ${evt.message}`);
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
  const report = session.status.kind === "ok" ? session.status.report : null;
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

  const middlePlaceholder =
    session.status.kind === "running"
      ? session.status.stage
        ? `Stage ${session.status.stage.index}/${session.status.stage.total} · ${session.status.stage.name}`
        : "Starting engine…"
      : session.status.kind === "error"
        ? `Error: ${session.status.message}`
        : session.status.kind === "cancelled"
          ? "Comparison cancelled. Click Run to retry."
          : session.layer === "diagnostic_overlay.png" && report && unifiedBuilding
            ? "Compositing unified view…"
            : "Run a comparison to see heatmaps";

  const onAddBox = useCallback(
    (box: BoundingBox) => addAnnotation(session.id, box),
    [addAnnotation, session.id],
  );
  const onDeleteBox = useCallback(
    (id: string) => removeAnnotation(session.id, id),
    [removeAnnotation, session.id],
  );
  const onSaveImage = useCallback(
    (blob: Blob, filename: string, writtenPath?: string) => {
      if (writtenPath) {
        // File was already persisted next to the source by ImageCanvas.
        toast("success", `Saved to ${writtenPath}`);
        return;
      }
      // Fallback: trigger a browser download.
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

  useEffect(() => {
    void renameSession;
  }, [renameSession]);

  // Reload: force re-fetch of input images (cache-buster) and re-run if
  // we already have a valid pair. A brand-new timestamp on the resolved
  // src triggers <img> reload even if the path didn't change.
  const [reloadNonce, setReloadNonce] = useState(0);
  useEffect(() => {
    if (reloadNonce === 0) return;
    let cancelled = false;
    Promise.all([
      resolveImageSrc(session.referencePath),
      resolveImageSrc(session.targetPath),
    ]).then(([r, t]) => {
      if (cancelled) return;
      setRefSrc(r ? `${r}${r.includes("?") ? "&" : "?"}_r=${reloadNonce}` : null);
      setTgtSrc(t ? `${t}${t.includes("?") ? "&" : "?"}_r=${reloadNonce}` : null);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, session.referencePath, session.targetPath]);

  const reload = useCallback(() => {
    setReloadNonce(Date.now());
    if (session.referencePath && session.targetPath && !running) run();
  }, [run, running, session.referencePath, session.targetPath]);

  const saveAll = useCallback(async () => {
    if (!refSrc || !tgtSrc || !middleSrc || !session.targetPath) {
      toast("error", "Nothing to save yet — run a comparison first");
      return;
    }
    try {
      const { writtenPath, filename } = await saveCombinedImage({
        targetPath: session.targetPath,
        leftSrc: refSrc,
        middleSrc,
        rightSrc: tgtSrc,
        labels: {
          left: "Left · Reference",
          middle: `Output · ${labelFor(session.layer)}`,
          right: "Right · Target",
        },
        report,
        variant: layerSlug(session.layer),
        annotations: session.annotations,
      });
      toast("success", writtenPath ? `Saved to ${writtenPath}` : `Saved ${filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast("error", `Save failed: ${msg}`);
    }
  }, [middleSrc, refSrc, report, session.annotations, session.layer, session.targetPath, tgtSrc]);

  const actionCluster = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={reload}
        disabled={!session.referencePath || !session.targetPath || running}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-[12px] transition-colors"
        title="Reload input images and re-run"
      >
        <RotateCw size={12} /> Reload
      </button>
      <button
        type="button"
        onClick={saveAll}
        disabled={!report || !refSrc || !tgtSrc || !middleSrc}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-[12px] transition-colors"
        title="Save combined Left + Output + Right PNG next to the target image"
      >
        <Download size={12} /> Save All
      </button>
      {running ? (
        <button
          type="button"
          onClick={cancel}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-signal-danger/50 bg-signal-danger/10 text-signal-danger text-[12px] font-medium hover:bg-signal-danger/20 transition-colors"
        >
          <XCircle size={13} /> Cancel
        </button>
      ) : (
        <button
          type="button"
          disabled={!canRun}
          onClick={run}
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
        activePaths={[session.referencePath, session.targetPath]}
        action={actionCluster}
      />

      <SessionHeader
        kind="file"
        leftLabel="L"
        rightLabel="R"
        leftValue={session.referencePath}
        onCommitLeft={onCommitA}
        rightValue={session.targetPath}
        onCommitRight={onCommitB}
        middle={
          <div className="flex items-center gap-3 w-full justify-center">
            <ColorPalette value={drawColor} onChange={setDrawColor} />
            <ClearAnnotationsButton
              count={session.annotations.length}
              onClick={() => clearAnnotations(session.id)}
            />
          </div>
        }
      />

      <div className="flex-1 flex min-h-0 min-w-0 relative">
        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={session.id}
            src={refSrc}
            label="L"
            placeholder="Paste a path above, drag an image here, or click the folder icon"
            boxes={session.annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(session.referencePath) || "reference"}-annotated`}
            sourcePath={session.referencePath}
            footerReport={report}
            onDropPath={onCommitA}
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
            boxes={session.annotations}
            onDrawBox={onAddBox}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${labelFor(session.layer)}-annotated`}
            sourcePath={session.targetPath}
            saveVariant={layerSlug(session.layer)}
            footerReport={report}
          />
          {session.layer === "diagnostic_overlay.png" && report && (
            <div className="absolute top-12 left-2 z-40 pointer-events-auto">
              <UnifiedToggles
                enabled={unifiedToggled}
                onToggle={toggleLayer}
                available={available}
                orientation="vertical"
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <ImageCanvas
            sessionId={session.id}
            src={tgtSrc}
            label="R"
            placeholder="Paste a path above, drag an image here, or click the folder icon"
            boxes={session.annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(session.targetPath) || "target"}-annotated`}
            sourcePath={session.targetPath}
            footerReport={report}
            onDropPath={onCommitB}
          />
        </div>
      </div>

      <MetricsDashboard
        report={report}
        status={session.status.kind}
        runningStatus={session.status.kind === "running" ? session.status : undefined}
      />
    </div>
  );
}

function basename(path: string | null): string {
  if (!path) return "";
  return path.split(/[\\/]/).pop() ?? path;
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

/** Filename-friendly suffix for the output pane's saved copy. */
function layerSlug(layer: string): string {
  return labelFor(layer).toLowerCase().replace(/\s+/g, "_");
}
