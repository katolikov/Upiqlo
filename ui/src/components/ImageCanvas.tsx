import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clamp,
  fitScale,
  imageBox,
  normalizedToPane,
  paneToNormalized,
} from "@/lib/viewport-math";
import { useViewport } from "@/state/viewport";
import type { BoundingBox } from "@/state/sessions";

/**
 * Universal image pane.
 *
 * Container size is fixed by its parent (flex column); zooming never
 * resizes the container — only the image inside transforms. Annotations
 * live in normalised [0, 1] image coordinates so they stay anchored to
 * their pixels during pan / zoom.
 *
 * Controls
 * --------
 *   Left-click + drag  → pan
 *   Scroll wheel       → zoom anchored at cursor
 *   Right-click + drag → draw a bounding box (drawable=true only)
 *   Double-click       → reset to fit
 *   +/− buttons        → zoom anchored at container centre
 *   Scrollbar drag     → pan via UI thumb
 *   OS drag-and-drop   → loads the file when onDropPath is provided
 */
export interface ImageCanvasProps {
  sessionId: string;
  src: string | null;
  label?: string;
  /** Replaces the default label chip with a custom element (used for the
   * Output pane's merged dropdown-title). */
  headerSlot?: React.ReactNode;
  placeholder?: string;
  className?: string;
  controls?: boolean;
  drawable?: boolean;
  boxes: BoundingBox[];
  onDrawBox?: (box: BoundingBox) => void;
  onDeleteBox?: (id: string) => void;
  drawColor?: string;
  onSave?: (blob: Blob, filename: string) => void;
  saveFilenameBase?: string;
  onDropPath?: (path: string) => void;
}

/** Professional palette: distinct hues, comfortably saturated, not neon. */
export const BOX_COLORS: string[] = [
  "#D6521F", // Burnt Sienna
  "#4F8AA3", // Dusk Blue
  "#5F9755", // Moss Green
  "#C58F3B", // Amber Ochre
  "#7A5BA6", // Iris Purple
  "#B84A6C", // Dusty Rose
];

export function ImageCanvas({
  sessionId,
  src,
  label,
  headerSlot,
  placeholder,
  className,
  controls = true,
  drawable = false,
  boxes,
  onDrawBox,
  onDeleteBox,
  drawColor = BOX_COLORS[0],
  onSave,
  saveFilenameBase = "upiqlo",
  onDropPath,
}: ImageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const transform = useViewport((s) => s.transforms[sessionId] ?? { scale: 1, tx: 0, ty: 0 });
  const zoomAt = useViewport((s) => s.zoomAt);
  const panBy = useViewport((s) => s.panBy);
  const setTransform = useViewport((s) => s.set);
  const reset = useViewport((s) => s.reset);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [cont, setCont] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const [drawRect, setDrawRect] = useState<null | {
    x0: number; y0: number; x1: number; y1: number;
  }>(null);
  const [hoverDrop, setHoverDrop] = useState(false);
  const [hoverPx, setHoverPx] = useState<{ x: number; y: number } | null>(null);

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

  // Clear natural size when src changes so a new image reloads cleanly.
  useEffect(() => {
    setNatural(null);
    setHoverPx(null);
  }, [src]);

  // --- Zoom -----------------------------------------------------------
  const wheelZoom = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = Math.pow(1.0015, -e.deltaY);
      zoomAt(sessionId, factor, cx, cy, rect.width, rect.height);
    },
    [sessionId, zoomAt],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  const zoomCenter = useCallback(
    (factor: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      zoomAt(sessionId, factor, rect.width / 2, rect.height / 2, rect.width, rect.height);
    },
    [sessionId, zoomAt],
  );

  // --- Pointer (pan + right-click draw) ------------------------------
  const suppressContext = useCallback((e: React.MouseEvent) => e.preventDefault(), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (e.button === 2 && drawable && box) {
        if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setDrawRect({ x0: px, y0: py, x1: px, y1: py });
          return;
        }
      }

      if (e.button === 0) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
      }
    },
    [box, drawable],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      if (natural && box && px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
        const norm = paneToNormalized(px, py, box);
        setHoverPx({
          x: Math.max(0, Math.min(natural.w - 1, Math.floor(norm.x * natural.w))),
          y: Math.max(0, Math.min(natural.h - 1, Math.floor(norm.y * natural.h))),
        });
      } else if (hoverPx) {
        setHoverPx(null);
      }

      if (drawRect) {
        setDrawRect({ ...drawRect, x1: px, y1: py });
        return;
      }
      if (dragging) panBy(sessionId, e.movementX, e.movementY);
    },
    [box, dragging, drawRect, hoverPx, natural, panBy, sessionId],
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

  const onPointerLeave = useCallback(() => setHoverPx(null), []);
  const onDoubleClick = useCallback(() => reset(sessionId), [reset, sessionId]);

  // --- Drag-and-drop --------------------------------------------------
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
      const p = first?.path;
      if (p) onDropPath(p);
    },
    [onDropPath],
  );

  // --- Save -----------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!src || !natural || !onSave) return;
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

  // --- Scrollbars -----------------------------------------------------
  const hasHScroll = !!box && box.w > cont.w + 0.5;
  const hasVScroll = !!box && box.h > cont.h + 0.5;

  const hThumbSize = hasHScroll && box ? Math.max(0.08, cont.w / box.w) : 1;
  const vThumbSize = hasVScroll && box ? Math.max(0.08, cont.h / box.h) : 1;
  const hThumbPos = hasHScroll && box ? clamp(-box.x / (box.w - cont.w), 0, 1) * (1 - hThumbSize) : 0;
  const vThumbPos = hasVScroll && box ? clamp(-box.y / (box.h - cont.h), 0, 1) * (1 - vThumbSize) : 0;

  const onHScrollClick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasHScroll || !box || !natural) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const extra = box.w - cont.w;
      const targetLeft = -frac * extra;
      const base = fitScale(natural.w, natural.h, cont.w, cont.h);
      const scale = base * transform.scale;
      const tx = targetLeft - (cont.w - scale * natural.w) / 2;
      setTransform(sessionId, { ...transform, tx });
    },
    [box, cont.w, hasHScroll, natural, sessionId, setTransform, transform],
  );

  const onVScrollClick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasVScroll || !box || !natural) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = clamp((e.clientY - rect.top) / rect.height, 0, 1);
      const extra = box.h - cont.h;
      const targetTop = -frac * extra;
      const base = fitScale(natural.w, natural.h, cont.w, cont.h);
      const scale = base * transform.scale;
      const ty = targetTop - (cont.h - scale * natural.h) / 2;
      setTransform(sessionId, { ...transform, ty });
    },
    [box, cont.h, cont.w, hasVScroll, natural, sessionId, setTransform, transform],
  );

  const imgStyle = box
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
      onWheel={wheelZoom}
      onContextMenu={suppressContext}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onDragOver={onHtmlDragOver}
      onDragLeave={onHtmlDragLeave}
      onDrop={onHtmlDrop}
      className={cn(
        "relative flex-1 min-w-0 min-h-0 overflow-hidden bg-surface-sunken select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        hoverDrop && "ring-2 ring-accent/60",
        className,
      )}
      title={
        drawable
          ? "Left-click-drag to pan · right-click-drag to draw · wheel to zoom · double-click to reset"
          : "Left-click-drag to pan · wheel to zoom · double-click to reset · drag-and-drop to load"
      }
    >
      {headerSlot ? (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20">{headerSlot}</div>
      ) : label ? (
        <div className="absolute top-2 left-2 z-20 px-2 py-0.5 text-[11px] font-medium text-text-muted bg-surface/80 backdrop-blur rounded border border-surface-border pointer-events-none">
          {label}
        </div>
      ) : null}

      {controls && src && (
        <>
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); reset(sessionId); }}
              className="w-7 h-7 rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted hover:text-text hover:bg-surface-raised flex items-center justify-center transition-colors"
              title="Reset to fit"
            >
              <Maximize2 size={12} />
            </button>
            {onSave && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void handleSave(); }}
                className="w-7 h-7 rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted hover:text-text hover:bg-surface-raised flex items-center justify-center transition-colors"
                title="Save copy (with annotations baked in)"
              >
                <Save size={12} />
              </button>
            )}
          </div>

          <div className="absolute bottom-4 right-4 z-20 flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); zoomCenter(1.25); }}
              className="w-7 h-7 rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted hover:text-text hover:bg-surface-raised flex items-center justify-center transition-colors"
              title="Zoom in"
            >
              <Plus size={13} />
            </button>
            <div className="text-[9px] text-text-faint tabular-nums">
              {Math.round(transform.scale * 100)}%
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); zoomCenter(1 / 1.25); }}
              className="w-7 h-7 rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted hover:text-text hover:bg-surface-raised flex items-center justify-center transition-colors"
              title="Zoom out"
            >
              <Minus size={13} />
            </button>
          </div>
        </>
      )}

      {hoverPx && natural && (
        <div className="absolute bottom-2 left-2 z-20 px-2 py-0.5 text-[10px] font-mono tabular-nums rounded border border-surface-border bg-surface/80 backdrop-blur text-text-muted pointer-events-none">
          {hoverPx.x}, {hoverPx.y} px · {natural.w}×{natural.h}
        </div>
      )}

      {src ? (
        <img
          ref={imgRef}
          src={src}
          alt={label ?? ""}
          draggable={false}
          onLoad={onImgLoad}
          className="absolute top-0 left-0 pointer-events-none"
          style={imgStyle}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-faint p-4 text-center">
          {placeholder ?? "No image — drag & drop a file, or paste a path above"}
        </div>
      )}

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
                  strokeWidth={2.5}
                  onClick={(e) => { e.stopPropagation(); if (onDeleteBox) onDeleteBox(b.id); }}
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

      {drawRect && (
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
          <rect
            x={Math.min(drawRect.x0, drawRect.x1)}
            y={Math.min(drawRect.y0, drawRect.y1)}
            width={Math.abs(drawRect.x1 - drawRect.x0)}
            height={Math.abs(drawRect.y1 - drawRect.y0)}
            fill={`${drawColor}33`}
            stroke={drawColor}
            strokeWidth={2.5}
            strokeDasharray="4 3"
          />
        </svg>
      )}

      {controls && src && hasHScroll && (
        <div
          onPointerDown={onHScrollClick}
          className="absolute left-1 right-12 bottom-1 h-2 z-20 bg-surface/60 rounded cursor-pointer"
        >
          <div
            className="h-full bg-accent/70 rounded"
            style={{ width: `${hThumbSize * 100}%`, marginLeft: `${hThumbPos * 100}%` }}
          />
        </div>
      )}
      {controls && src && hasVScroll && (
        <div
          onPointerDown={onVScrollClick}
          className="absolute top-10 bottom-24 right-1 w-2 z-20 bg-surface/60 rounded cursor-pointer"
        >
          <div
            className="w-full bg-accent/70 rounded"
            style={{ height: `${vThumbSize * 100}%`, marginTop: `${vThumbPos * 100}%` }}
          />
        </div>
      )}

      {hoverDrop && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-accent/10 text-accent text-sm font-medium pointer-events-none">
          Drop image here
        </div>
      )}

      {!natural && src && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-text-faint text-xs">
          Loading…
        </div>
      )}
    </div>
  );
}

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
            "w-5 h-5 rounded border transition-transform",
            value === c
              ? "border-text ring-2 ring-text/30 scale-110"
              : "border-surface-border hover:scale-105",
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
        "flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
        className,
      )}
      title={count === 0 ? "No annotations" : `Clear ${count} annotation${count === 1 ? "" : "s"}`}
    >
      <Trash2 size={11} />
      Clear ({count})
    </button>
  );
}
