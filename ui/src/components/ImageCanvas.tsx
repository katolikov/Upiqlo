import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fitScale,
  imageBox,
  normalizedToPane,
  paneToNormalized,
} from "@/lib/viewport-math";
import { useViewport } from "@/state/viewport";
import type { BoundingBox } from "@/state/sessions";

/**
 * The universal image-pane used by Reference / Output / Target.
 *
 * Responsibilities:
 *   * Strictly fits inside the parent column; never overflows.
 *   * Pan & zoom that stay inside this canvas (the *container* never moves).
 *   * Renders a shared set of normalized-coord bounding boxes and lets the
 *     user draw new ones when `drawable=true`.
 *   * Reset-to-fit + Save-as-PNG-with-boxes overlay buttons.
 */
export interface ImageCanvasProps {
  sessionId: string;
  src: string | null;
  label: string;
  placeholder?: string;
  className?: string;
  /** Draw overlay controls (reset / save). Defaults to true. */
  controls?: boolean;
  /** Whether clicks-drag draws new boxes. Enable on the middle pane only. */
  drawable?: boolean;
  /** The shared normalized bounding boxes (rendered on every pane). */
  boxes: BoundingBox[];
  /** Called when drawable=true and the user completes a new box. */
  onDrawBox?: (box: BoundingBox) => void;
  /** Called when the user clicks a box — typically deletes it. */
  onDeleteBox?: (id: string) => void;
  /** Active drawing color for new boxes. */
  drawColor?: string;
  /** Called when the user clicks the Save button. Receives the PNG Blob
   * of the currently-rendered image with any bounding boxes baked in. */
  onSave?: (blob: Blob, filename: string) => void;
  /** Filename to suggest when saving (without extension). */
  saveFilenameBase?: string;
  /** Accept OS drag-drop onto this pane. When set, external file drops
   * (either via HTML5 dragover or via Tauri's drag event) land here. */
  onDropPath?: (path: string) => void;
}

export function ImageCanvas({
  sessionId,
  src,
  label,
  placeholder,
  className,
  controls = true,
  drawable = false,
  boxes,
  onDrawBox,
  onDeleteBox,
  drawColor = "#7A3731",
  onSave,
  saveFilenameBase = "upiqlo",
  onDropPath,
}: ImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const transform = useViewport((s) => s.transforms[sessionId] ?? { scale: 1, tx: 0, ty: 0 });
  const zoomBy = useViewport((s) => s.zoomBy);
  const panBy = useViewport((s) => s.panBy);
  const reset = useViewport((s) => s.reset);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [cont, setCont] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [drawRect, setDrawRect] = useState<null | {
    x0: number; y0: number; x1: number; y1: number;
  }>(null);
  const [hoverDrop, setHoverDrop] = useState(false);

  // Observe the container's own size so the image fits exactly, never overflows.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setCont({ w: cr.width, h: cr.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const box = useMemo(() => {
    if (!natural || !cont.w || !cont.h) return null;
    return imageBox(natural.w, natural.h, cont.w, cont.h, transform);
  }, [natural, cont, transform]);

  const onImgLoad = useCallback(() => {
    if (imgRef.current) {
      setNatural({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  }, []);

  // ------------------------- Interaction -------------------------
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.pow(1.0015, -e.deltaY);
      zoomBy(sessionId, factor, cx, cy);
    },
    [sessionId, zoomBy],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      if (drawable && box && e.shiftKey === false && e.altKey === false) {
        // Start drawing a bounding box (only when the click begins inside
        // the image's rendered area — outside clicks just pan).
        if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
          setDrawRect({ x0: px, y0: py, x1: px, y1: py });
          return;
        }
      }
      setDragging(true);
    },
    [drawable, box],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (drawRect) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setDrawRect({
          ...drawRect,
          x1: e.clientX - rect.left,
          y1: e.clientY - rect.top,
        });
        return;
      }
      if (dragging) panBy(sessionId, e.movementX, e.movementY);
    },
    [dragging, drawRect, panBy, sessionId],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (drawRect && box && onDrawBox) {
        const minX = Math.min(drawRect.x0, drawRect.x1);
        const minY = Math.min(drawRect.y0, drawRect.y1);
        const maxX = Math.max(drawRect.x0, drawRect.x1);
        const maxY = Math.max(drawRect.y0, drawRect.y1);
        // Reject tiny rectangles (< 6 px).
        if (maxX - minX >= 6 && maxY - minY >= 6) {
          const tl = paneToNormalized(minX, minY, box);
          const br = paneToNormalized(maxX, maxY, box);
          onDrawBox({
            id: `box_${Math.random().toString(36).slice(2, 10)}`,
            x: Math.max(0, Math.min(1, Math.min(tl.x, br.x))),
            y: Math.max(0, Math.min(1, Math.min(tl.y, br.y))),
            w: Math.max(0, Math.min(1, Math.abs(br.x - tl.x))),
            h: Math.max(0, Math.min(1, Math.abs(br.y - tl.y))),
            color: drawColor,
          });
        }
      }
      setDrawRect(null);
      setDragging(false);
    },
    [box, drawColor, drawRect, onDrawBox],
  );

  const onDoubleClick = useCallback(() => reset(sessionId), [reset, sessionId]);

  // ------------------------- Drag-and-drop -------------------------
  const onHtmlDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onDropPath) return;
      e.preventDefault();
      e.stopPropagation();
      setHoverDrop(true);
    },
    [onDropPath],
  );
  const onHtmlDragLeave = useCallback(() => setHoverDrop(false), []);
  const onHtmlDrop = useCallback(
    (e: React.DragEvent) => {
      if (!onDropPath) return;
      e.preventDefault();
      e.stopPropagation();
      setHoverDrop(false);
      const first = e.dataTransfer.files?.[0] as File & { path?: string } | undefined;
      // In dev (browser), File.path is undefined; Tauri webview exposes it on some platforms.
      const p = first?.path;
      if (p) onDropPath(p);
    },
    [onDropPath],
  );

  // ------------------------- Save with boxes -------------------------
  const handleSave = useCallback(async () => {
    if (!src || !natural || !onSave) return;
    // Load the image via a plain <img> (same-origin through asset:// works).
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image load failed"));
      image.src = src;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    // Burn in the bounding boxes at native resolution.
    ctx.lineWidth = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) / 400));
    for (const b of boxes) {
      ctx.strokeStyle = b.color;
      ctx.strokeRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
      if (b.label) {
        ctx.fillStyle = b.color;
        ctx.font = `${Math.max(10, Math.round(canvas.height / 60))}px sans-serif`;
        ctx.fillText(b.label, b.x * canvas.width + 4, b.y * canvas.height + 14);
      }
    }
    canvas.toBlob((blob) => {
      if (blob) onSave(blob, `${saveFilenameBase}.png`);
    }, "image/png");
  }, [boxes, natural, onSave, saveFilenameBase, src]);

  // ------------------------- Render -------------------------
  const transformStyle = box
    ? {
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: `${box.w}px`,
        height: `${box.h}px`,
        imageRendering: "pixelated" as const,
      }
    : { display: "none" };

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onDragOver={onHtmlDragOver}
      onDragLeave={onHtmlDragLeave}
      onDrop={onHtmlDrop}
      className={cn(
        "relative flex-1 min-w-0 min-h-0 overflow-hidden bg-surface-sunken select-none",
        drawable ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab",
        hoverDrop && "ring-2 ring-accent/60",
        className,
      )}
      title={
        drawable
          ? "Click-drag to draw a box · wheel to zoom · double-click to reset"
          : "Drag to pan · wheel to zoom · double-click to reset · drag-and-drop to load"
      }
    >
      {/* Top-left label chip */}
      <div className="absolute top-2 left-2 z-20 px-2 py-0.5 text-[11px] font-medium text-text-muted bg-surface/80 backdrop-blur rounded border border-surface-border pointer-events-none">
        {label}
      </div>

      {/* Overlay controls */}
      {controls && src && (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              reset(sessionId);
            }}
            className="w-7 h-7 rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted hover:text-text hover:bg-surface-raised flex items-center justify-center"
            title="Reset to fit"
          >
            <Maximize2 size={12} />
          </button>
          {onSave && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleSave();
              }}
              className="w-7 h-7 rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted hover:text-text hover:bg-surface-raised flex items-center justify-center"
              title="Save image (with annotations baked in)"
            >
              <Save size={12} />
            </button>
          )}
        </div>
      )}

      {/* The image itself */}
      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt={label}
          draggable={false}
          onLoad={onImgLoad}
          className="absolute top-0 left-0 pointer-events-none"
          style={transformStyle}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-faint p-4 text-center">
          {placeholder ?? "No image — drag & drop a file here, or pick one"}
        </div>
      )}

      {/* Bounding box overlay (rendered in pane coords) */}
      {box && boxes.length > 0 && (
        <svg
          className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
          viewBox={`0 0 ${cont.w} ${cont.h}`}
          preserveAspectRatio="none"
        >
          {boxes.map((b) => {
            const tl = normalizedToPane(b.x, b.y, box);
            const br = normalizedToPane(b.x + b.w, b.y + b.h, box);
            const rx = Math.min(tl.x, br.x);
            const ry = Math.min(tl.y, br.y);
            const rw = Math.abs(br.x - tl.x);
            const rh = Math.abs(br.y - tl.y);
            return (
              <g key={b.id} className={onDeleteBox ? "pointer-events-auto cursor-pointer" : ""}>
                <rect
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill="none"
                  stroke={b.color}
                  strokeWidth={2}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onDeleteBox) onDeleteBox(b.id);
                  }}
                />
                {b.label && (
                  <text
                    x={rx + 4}
                    y={ry + 12}
                    fill={b.color}
                    fontSize="11"
                    fontFamily="system-ui, sans-serif"
                    style={{ paintOrder: "stroke", stroke: "#0f0c09", strokeWidth: 2 }}
                  >
                    {b.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {/* In-progress drawing rectangle */}
      {drawRect && (
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
          <rect
            x={Math.min(drawRect.x0, drawRect.x1)}
            y={Math.min(drawRect.y0, drawRect.y1)}
            width={Math.abs(drawRect.x1 - drawRect.x0)}
            height={Math.abs(drawRect.y1 - drawRect.y0)}
            fill={`${drawColor}33`}
            stroke={drawColor}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
        </svg>
      )}

      {hoverDrop && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-accent/10 text-accent text-sm font-medium pointer-events-none">
          Drop image here
        </div>
      )}

      {/* Empty-state placeholder overlay when boxes exist but no image */}
      {!src && drawable && boxes.length > 0 && (
        <div className="absolute bottom-2 left-2 z-10 text-[10px] text-text-faint">
          ({boxes.length} annotation{boxes.length === 1 ? "" : "s"})
        </div>
      )}

      {!natural && src && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-text-faint text-xs">
          Loading…
        </div>
      )}

      {/* Fit-scale helper — keeps the base scale sane if the image's
          natural size happens to match container exactly. */}
      {natural && box && fitScale(natural.w, natural.h, cont.w, cont.h) === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-text-faint">
          (resize the column)
        </div>
      )}
    </div>
  );
}

/** Small color-palette picker for bounding boxes. */
export const BOX_COLORS = [
  "#7A3731", // Faded Brick (accent)
  "#b08953", // Warning / ochre
  "#7f8f5e", // Success / moss
  "#5E3A23", // Oxidized Iron
  "#8C9295", // Cold Concrete
  "#b87333", // Copper
];

export function ColorPalette({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {BOX_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "w-5 h-5 rounded border",
            value === c ? "border-text-muted ring-2 ring-text-muted/40" : "border-surface-border",
          )}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
    </div>
  );
}

export function ClearAnnotationsButton({
  count,
  onClick,
  className,
}: {
  count: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0}
      className={cn(
        "flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed",
        className,
      )}
      title={count === 0 ? "No annotations" : `Clear ${count} annotation${count === 1 ? "" : "s"}`}
    >
      <Trash2 size={11} />
      Clear ({count})
    </button>
  );
}

