import { useCallback, useEffect, useRef, useState } from "react";
import { FileImage, Play, XCircle } from "lucide-react";
import { pickImageFile } from "@/lib/pickers";
import { streamCompare } from "@/lib/stream";
import { heatmapDataUrl } from "@/lib/api";
import { resolveImageSrc } from "@/lib/assets";
import { onTauriFileDrop } from "@/lib/tauri-drag";
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
import {
  useSessions,
  type BoundingBox,
  type SingleSession,
} from "@/state/sessions";

interface Props {
  session: SingleSession;
}

/**
 * Single-image comparison mode: 3-pane workspace (A / Output / B), with
 * per-session config at the top, bounding-box annotation tools, and
 * streamed comparison with true cancellation.
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

  const streamRef = useRef<{ cancel: () => Promise<void> } | null>(null);
  useEffect(() => {
    return () => {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) void s.cancel();
    };
  }, []);

  // Resolve absolute paths to <img>-compatible URLs (asset:// in Tauri,
  // /api/file fallback in browser dev).
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

  // OS drag-drop: Tauri forwards dropped paths here. We fill whichever
  // pane is empty (ref first, then tgt).
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
      if (session.title === "New Comparison") {
        renameSession(session.id, filename(p0));
      }
    });
    return off;
  }, [session.id, session.title, setSinglePaths, renameSession]);

  const onPickRef = useCallback(async () => {
    const p = await pickImageFile("Select reference image (A)");
    if (p) {
      setSinglePaths(session.id, p, session.targetPath);
      if (session.title === "New Comparison") renameSession(session.id, filename(p));
    }
  }, [session.id, session.targetPath, session.title, setSinglePaths, renameSession]);

  const onPickTgt = useCallback(async () => {
    const p = await pickImageFile("Select target image (B)");
    if (p) setSinglePaths(session.id, session.referencePath, p);
  }, [session.id, session.referencePath, setSinglePaths]);

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

  const heatmapB64 = report?.heatmaps[session.layer] ?? null;
  const middleSrc = heatmapB64 ? heatmapDataUrl(heatmapB64) : null;
  const available = new Set(Object.keys(report?.heatmaps ?? {}));

  const middlePlaceholder =
    session.status.kind === "running"
      ? session.status.stage
        ? `Stage ${session.status.stage.index}/${session.status.stage.total} · ${session.status.stage.name}`
        : "Starting engine…"
      : session.status.kind === "error"
        ? `Error: ${session.status.message}`
        : session.status.kind === "cancelled"
          ? "Comparison cancelled. Click Compare to retry."
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

  const onDropRef = useCallback(
    (path: string) => {
      setSinglePaths(session.id, path, session.targetPath);
      if (session.title === "New Comparison") renameSession(session.id, filename(path));
    },
    [renameSession, session.id, session.targetPath, session.title, setSinglePaths],
  );
  const onDropTgt = useCallback(
    (path: string) => setSinglePaths(session.id, session.referencePath, path),
    [setSinglePaths, session.id, session.referencePath],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <SessionConfigBar sessionId={session.id} params={session.params} />

      <div className="h-10 border-b border-surface-border bg-surface flex items-center px-3 gap-3 shrink-0 text-[12px]">
        <PathPicker label="A" value={session.referencePath} onPick={onPickRef} />
        <PathPicker label="B" value={session.targetPath} onPick={onPickTgt} />

        {session.status.kind === "running" ? (
          <ProgressBar status={session.status} />
        ) : (
          <div className="flex-1" />
        )}

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

      <div className="flex-1 flex min-h-0 min-w-0 relative">
        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={session.id}
            src={refSrc}
            label="A · Reference"
            placeholder="Pick a reference image · or drag & drop"
            boxes={session.annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${filename(session.referencePath) || "reference"}-annotated`}
            onDropPath={onDropRef}
          />
        </div>

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
            placeholder="Pick a target image · or drag & drop"
            boxes={session.annotations}
            onDeleteBox={onDeleteBox}
            onSave={onSaveImage}
            saveFilenameBase={`${filename(session.targetPath) || "target"}-annotated`}
            onDropPath={onDropTgt}
          />
        </div>
      </div>

      <MetricsDashboard report={report} status={session.status.kind} />
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
      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised max-w-[280px] shrink-0"
      title={value ?? "Click to pick an image, or drag one into the pane"}
    >
      <FileImage size={12} />
      <span className="font-medium">{label}</span>
      <span className="truncate text-[11px]">{value ? filename(value) : "Pick image…"}</span>
    </button>
  );
}

function filename(path: string | null): string {
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
