import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, XCircle } from "lucide-react";
import { streamCompare } from "@/lib/stream";
import { heatmapDataUrl } from "@/lib/api";
import { resolveImageSrc } from "@/lib/assets";
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
import { ProgressBar } from "@/components/ProgressBar";
import { SessionConfigBar } from "@/components/SessionConfigBar";
import { SessionHeader } from "@/components/SessionHeader";
import { UnifiedToggles } from "@/components/UnifiedToggles";
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
 *   [ config bar ............................................ ]
 *   [ A path input ............  middle  ........ B path input ]
 *   [ action bar: color | clear | Compare / Cancel .............. ]
 *   [ A canvas   |   Output canvas   |   B canvas               ]
 *   [ metrics dashboard ...................................... ]
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

  // Stream handle so the Cancel button and unmount cleanup can tear down.
  const streamRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  useEffect(() => {
    return () => {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) void s.cancel();
    };
  }, []);

  // Resolve A/B abs paths to webview-friendly URLs.
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

  // OS drag-drop via Tauri → load into A first, then B.
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

  // --- Unified canvas composite: rebuild when toggles or heatmaps change ---
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

  // Reset toggles when the session's available layers change — keep only
  // ones present in the new report.
  useEffect(() => {
    if (!report) return;
    setUnifiedToggled((prev) => {
      const keep = new Set<string>();
      for (const k of prev) if (available.has(k)) keep.add(k);
      for (const spec of UNIFIED_LAYERS) {
        if (available.has(spec.key) && keep.size === 0) keep.add(spec.key);
      }
      // If nothing kept (first render after a run), default to everything.
      if (keep.size === 0) {
        for (const spec of UNIFIED_LAYERS) if (available.has(spec.key)) keep.add(spec.key);
      }
      return keep;
    });
  }, [available, report]);

  // Resolve the middle-pane image source.
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
          ? "Comparison cancelled. Click Compare to retry."
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

  const toggleLayer = useCallback((key: UnifiedArtifact) => {
    setUnifiedToggled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Update the session title on first path commit if the user hasn't
  // renamed the auto-generated title yet.
  useEffect(() => {
    // no-op: session title is auto-generated and purposely stable.
    void renameSession;
  }, [renameSession]);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <SessionConfigBar sessionId={session.id} params={session.params} />

      {/* A input on far left, B input on far right, action bar in the middle. */}
      <SessionHeader
        kind="file"
        leftLabel="A · Reference"
        rightLabel="B · Target"
        leftValue={session.referencePath}
        onCommitLeft={onCommitA}
        rightValue={session.targetPath}
        onCommitRight={onCommitB}
        middle={
          <div className="flex items-center gap-3 px-2 w-full justify-center">
            {session.status.kind === "running" ? (
              <ProgressBar status={session.status} />
            ) : null}
            <ColorPalette value={drawColor} onChange={setDrawColor} />
            <ClearAnnotationsButton
              count={session.annotations.length}
              onClick={() => clearAnnotations(session.id)}
            />
            {running ? (
              <button
                type="button"
                onClick={cancel}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-signal-danger/50 bg-signal-danger/10 text-signal-danger text-[12px] font-medium hover:bg-signal-danger/20"
              >
                <XCircle size={13} /> Cancel
              </button>
            ) : (
              <button
                type="button"
                disabled={!canRun}
                onClick={run}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-accent text-white text-[12px] font-medium hover:bg-accent-hot disabled:bg-surface-sunken disabled:text-text-faint disabled:cursor-not-allowed"
              >
                <Play size={13} /> Compare
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 flex min-h-0 min-w-0 relative">
        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={session.id}
            src={refSrc}
            label="A · Reference"
            placeholder="Paste an A path above, drag an image here, or click the folder icon"
            boxes={session.annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(session.referencePath) || "reference"}-annotated`}
            onDropPath={onCommitA}
          />
        </div>

        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border relative">
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 max-w-[92%]">
            <LayerDropdown
              value={session.layer}
              onChange={(l) => setLayer(session.id, l)}
              available={available}
            />
            {session.layer === "diagnostic_overlay.png" && report && (
              <div className="px-2 py-1.5 rounded-md bg-surface-raised/90 backdrop-blur border border-surface-border">
                <UnifiedToggles
                  enabled={unifiedToggled}
                  onToggle={toggleLayer}
                  available={available}
                />
              </div>
            )}
          </div>
          <ImageCanvas
            sessionId={session.id}
            src={middleSrc}
            label={`Output · ${labelFor(session.layer)}`}
            placeholder={middlePlaceholder}
            drawable
            drawColor={drawColor}
            boxes={session.annotations}
            onDrawBox={onAddBox}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${labelFor(session.layer)}-annotated`}
          />
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <ImageCanvas
            sessionId={session.id}
            src={tgtSrc}
            label="B · Target"
            placeholder="Paste a B path above, drag an image here, or click the folder icon"
            boxes={session.annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${basename(session.targetPath) || "target"}-annotated`}
            onDropPath={onCommitB}
          />
        </div>
      </div>

      <MetricsDashboard report={report} status={session.status.kind} />
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
