import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Download, FileImage, Folder as FolderIcon, Play, RotateCw, XCircle } from "lucide-react";
import { isTauri } from "@/lib/assets";
import { saveCombinedImage } from "@/lib/save-combined";
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
 * Active stream registry keyed by `${sessionId}:${pairId}` so a
 * folder-compare run keeps going when the user switches tabs, goes
 * to the Start screen, or picks a different pair — the result lands
 * on the original pair when the stream completes.
 */
const activeFolderStreams = new Map<string, { cancel: () => Promise<void> }>();

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

  // (Image resolution runs below through the `reloadNonce` effect —
  // merging the two avoids a race where the plain resolver and the
  // cache-busting resolver could both land and overwrite each other.)

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
        const msg = e instanceof Error ? e.message : String(e);
        toast("error", `Folder scan failed: ${msg}`);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.referenceDir, session.targetDir, setFolderScan]);

  // Stream handle lives in a module-level registry keyed by
  // `${session.id}:${pairId}` so it keeps running past unmount (tab
  // switch / Start-screen navigation / picking a different pair).
  const streamRef = useRef<{ cancel: () => Promise<void> } | null>(null);

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
    const sid = session.id;
    const key = `${sid}:${currentPairId}`;
    const prev = activeFolderStreams.get(key);
    if (prev) void prev.cancel();
    activeFolderStreams.delete(key);

    setFolderPairStatus(sid, currentPairId, { kind: "running", startedAt: Date.now() });
    const p = session.params;
    const handle = streamCompare(
      {
        reference_path: session.activeReferencePath,
        target_path: session.activeTargetPath,
        session_id: sid,
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
        if (activeFolderStreams.get(key) !== handle) return;
        switch (evt.type) {
          case "open":
            setFolderPairStatus(sid, currentPairId, {
              kind: "running",
              startedAt: Date.now(),
              token: evt.token,
            });
            break;
          case "stage":
            setFolderPairStatus(sid, currentPairId, (prev) =>
              prev.kind === "running" ? { ...prev, stage: evt.stage } : prev,
            );
            break;
          case "result":
            setFolderPairStatus(sid, currentPairId, {
              kind: "ok",
              report: evt.report,
              finishedAt: Date.now(),
            });
            break;
          case "done":
            activeFolderStreams.delete(key);
            break;
          case "cancelled":
            setFolderPairStatus(sid, currentPairId, { kind: "cancelled" });
            activeFolderStreams.delete(key);
            break;
          case "error":
            setFolderPairStatus(sid, currentPairId, {
              kind: "error",
              message: evt.message,
            });
            toast("error", `Run failed: ${evt.message}`);
            activeFolderStreams.delete(key);
            break;
        }
      },
    );
    activeFolderStreams.set(key, handle);
    streamRef.current = handle;
  }, [currentPairId, session.activeReferencePath, session.activeTargetPath, session.id, session.params, setFolderPairStatus]);

  const cancelPair = useCallback(() => {
    if (!currentPairId) return;
    const key = `${session.id}:${currentPairId}`;
    const s = activeFolderStreams.get(key) ?? streamRef.current;
    activeFolderStreams.delete(key);
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

  // Non-zero initial nonce so the re-resolve path also runs on first
  // mount — keeps the middle/output pane from staying blank after a
  // tab switch when a background run has already produced a report.
  const [reloadNonce, setReloadNonce] = useState(() => Date.now());
  useEffect(() => {
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

  const saveAll = useCallback(async () => {
    if (!refSrc || !tgtSrc || !middleSrc || !session.activeTargetPath) {
      toast("error", "Nothing to save yet — run this pair first");
      return;
    }
    try {
      const { writtenPath, filename } = await saveCombinedImage({
        targetPath: session.activeTargetPath,
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
        annotations,
      });
      toast("success", writtenPath ? `Saved to ${writtenPath}` : `Saved ${filename}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast("error", `Save failed: ${msg}`);
    }
  }, [annotations, middleSrc, refSrc, report, session.activeTargetPath, session.layer, tgtSrc]);

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
          rootDir={session.referenceDir}
          fallbackFiles={referenceFiles}
          active={session.activeReferencePath}
          onPick={(p) => setFolderActiveRef(session.id, p)}
          className="border-r border-surface-border"
        />

        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={currentPairId ? `${session.id}:${currentPairId}` : session.id}
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
            sessionId={currentPairId ? `${session.id}:${currentPairId}` : session.id}
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

        <div className="flex-1 min-w-0 flex flex-col border-r border-surface-border">
          <ImageCanvas
            sessionId={currentPairId ? `${session.id}:${currentPairId}` : session.id}
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
          rootDir={session.targetDir}
          fallbackFiles={targetFiles}
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

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp",
  ".npy", ".raw", ".bin", ".yuv", ".nv21", ".nv12",
]);

function hasImageExt(name: string): boolean {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTS.has(lower.slice(dot));
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  const trimmed = dir.endsWith(sep) ? dir.slice(0, -1) : dir;
  return `${trimmed}${sep}${name}`;
}

function parentPath(p: string | null): string | null {
  if (!p) return null;
  const ix = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (ix <= 0) return null;
  const parent = p.slice(0, ix);
  return parent || null;
}

interface FileList_Entry { name: string; path: string; isDir: boolean; }

/**
 * Recursive directory browser for one side of the folder-compare
 * workspace. Starts at `rootDir` and uses the Tauri fs plugin's
 * readDir to list contents of the currently-viewed directory. The
 * user can drill into any subdirectory and climb back up via the
 * breadcrumb row. Picking a file sets this side's active image.
 *
 * `fallbackFiles` is used when we're not running inside Tauri (dev-
 * browser mode), where readDir isn't available — we fall back to the
 * flat file list from the engine's scan.
 */
function FileList({
  rootDir,
  fallbackFiles,
  active,
  onPick,
  className,
}: {
  rootDir: string | null;
  fallbackFiles: string[];
  active: string | null;
  onPick: (path: string) => void;
  className?: string;
}) {
  const [cursor, setCursor] = useState<string | null>(rootDir);
  const [entries, setEntries] = useState<FileList_Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Keep the cursor in sync with the session root when the user
  // changes the folder path from the header.
  useEffect(() => {
    setCursor(rootDir);
  }, [rootDir]);

  useEffect(() => {
    if (!cursor) {
      setEntries([]);
      return;
    }
    if (!isTauri()) {
      // Browser dev: fall back to the scan's flat list.
      setEntries(
        fallbackFiles.map((p) => ({
          name: p.split(/[\\/]/).filter(Boolean).pop() ?? p,
          path: p,
          isDir: false,
        })),
      );
      return;
    }
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const fs = await import("@tauri-apps/plugin-fs");
        const raw = await fs.readDir(cursor);
        if (cancelled) return;
        const mapped: FileList_Entry[] = raw
          .filter((e) => e.name && !e.name.startsWith("."))
          .map((e) => ({
            name: e.name!,
            path: joinPath(cursor, e.name!),
            isDir: Boolean(e.isDirectory),
          }))
          .filter((e) => e.isDir || hasImageExt(e.name));
        mapped.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
        setEntries(mapped);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cursor, fallbackFiles]);

  const atRoot = !rootDir || cursor === rootDir;
  const currentLabel = cursor ? basename(cursor) : "(no folder)";

  const goUp = () => {
    if (!cursor || !rootDir) return;
    if (cursor === rootDir) return; // stay inside session root
    const parent = parentPath(cursor);
    if (parent && parent.length >= rootDir.length) setCursor(parent);
    else setCursor(rootDir);
  };

  return (
    <aside
      className={cn(
        "w-56 shrink-0 flex flex-col bg-surface-raised min-h-0",
        className,
      )}
    >
      <div className="h-8 shrink-0 px-2 flex items-center gap-1 text-[11px] text-text-muted border-b border-surface-border">
        <button
          type="button"
          onClick={goUp}
          disabled={atRoot}
          className="p-0.5 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed"
          title="Up one level"
        >
          <ChevronLeft size={12} />
        </button>
        <span className="truncate font-medium" title={cursor ?? undefined}>
          {currentLabel}
        </span>
      </div>

      {error ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center text-[11px] text-signal-danger">
          {error}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center text-[11px] text-text-faint">
          (empty)
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto min-h-0">
          {entries.map((e) => {
            const activeRow = !e.isDir && active === e.path;
            return (
              <li key={e.path}>
                <button
                  type="button"
                  onClick={() => (e.isDir ? setCursor(e.path) : onPick(e.path))}
                  className={cn(
                    "w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] border-l-2 transition-colors",
                    activeRow
                      ? "bg-accent/15 text-accent border-accent"
                      : "text-text-muted border-transparent hover:bg-surface-hover/50 hover:text-text",
                  )}
                  title={e.path}
                >
                  {e.isDir ? (
                    <FolderIcon size={11} className="shrink-0 text-accent/80" />
                  ) : (
                    <FileImage size={11} className="shrink-0 text-text-faint" />
                  )}
                  <span className="truncate">{e.name}</span>
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
