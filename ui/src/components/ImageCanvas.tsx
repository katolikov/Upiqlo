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
import { toast } from "@/state/toast";

/**
 * Universal image pane.
 *
 * Container size is fixed by its parent; zooming never resizes the
 * container — only the image inside transforms. The image renders at
 * its natural width/height and is visually scaled with CSS transform
 * so the browser does not re-sample pixels every zoom tick (stable +
 * GPU-accelerated). Annotations live in normalised [0, 1] image
 * coordinates so they stay anchored to their pixels during pan / zoom.
 */
export interface ImageCanvasProps {
  sessionId: string;
  src: string | null;
  label?: string;
  /** Replaces the default label chip with a custom element (used for the
   * Output pane's merged dropdown/title). */
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

  const onImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const el = e.currentTarget as HTMLImageElement;
      if (el.naturalWidth > 0 && el.naturalHeight > 0) {
        setNatural({ w: el.naturalWidth, h: el.naturalHeight });
      }
    },
    [],
  );

  // Clear natural size when src changes so the new image loads cleanly.
  // Then, if the browser had the image in its cache, `img.complete` is
  // already true and onLoad may never fire — pull the dimensions
  // synchronously from the DOM element. Uses requestAnimationFrame to
  // let React commit the src update first.
  useEffect(() => {
    setNatural(null);
    setHoverPx(null);
    if (!src) return;
    let stopped = false;
    const check = () => {
      if (stopped) return;
      const el = imgRef.current;
      if (el && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
        setNatural({ w: el.naturalWidth, h: el.naturalHeight });
      }
    };
    const raf = requestAnimationFrame(check);
    // Second check slightly later in case decode is still in progress.
    const t = window.setTimeout(check, 120);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [src]);

  // --- Zoom -----------------------------------------------------------
  const wheelZoom = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Mild step per wheel tick; deltaMode 0 is pixels, 1 is lines, 2 is pages.
      const deltaY = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.pow(1.0015, -deltaY);
      zoomAt(sessionId, factor, cx, cy, rect.width, rect.height);
    },
    [sessionId, zoomAt],
  );

  // Pin the wheel event with passive=false so preventDefault stops the
  // webview from scrolling the outer container.
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
      // If the pointer went down on an interactive UI element (the
      // overlay buttons, the Output dropdown trigger, a legend chip,
      // an annotation rectangle, etc.) let that element handle the
      // click — don't start panning or a rectangle-draw, and do NOT
      // call setPointerCapture (which would otherwise steal pointerup
      // and click events from the target).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          "button, a, select, input, textarea, [data-ui], [role='button']",
        )
      ) {
        return;
      }

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
  //
  // Multi-stage strategy to survive every kind of src the canvas might
  // see (data:, blob:, asset://, http://127.0.0.1:<engine>):
  //
  //   1) Prefer drawing the already-loaded imgRef element directly. For
  //      data:/blob:/http:// sources this is always CORS-clean and
  //      toBlob() succeeds. For Tauri's asset:// it usually works too
  //      (assetProtocol serves CORS headers on recent Tauri 2.x).
  //
  //   2) If step 1 throws a SecurityError (tainted canvas), fall back
  //      to fetch(src) + createObjectURL(blob) and redraw through a
  //      blob: URL (always same-origin).
  //
  // Every failure is surfaced as an error toast so the user sees why
  // the save didn't happen.
  const drawAnnotations = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const stroke = Math.max(2, Math.round(Math.min(w, h) / 400));
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        const labelText = b.label ?? `Region ${i + 1}`;
        const rx = b.x * w;
        const ry = b.y * h;
        const rw = b.w * w;
        const rh = b.h * h;
        ctx.lineWidth = stroke + 2;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.lineWidth = stroke;
        ctx.strokeStyle = b.color;
        ctx.strokeRect(rx, ry, rw, rh);
        const fontPx = Math.max(11, Math.round(h / 70));
        ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
        const textW = ctx.measureText(labelText).width;
        ctx.fillStyle = b.color;
        ctx.fillRect(rx, ry - fontPx - 6, textW + 12, fontPx + 6);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(labelText, rx + 6, ry - 6);
      }
    },
    [boxes],
  );

  const handleSave = useCallback(async () => {
    if (!src || !onSave) return;
    const drawToBlob = (img: HTMLImageElement): Promise<Blob> =>
      new Promise((resolve, reject) => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w === 0 || h === 0) {
          reject(new Error("image not loaded"));
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("2d context unavailable"));
          return;
        }
        try {
          ctx.drawImage(img, 0, 0, w, h);
          drawAnnotations(ctx, w, h);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("toBlob returned null"));
          }, "image/png");
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

    try {
      // --- Path 1: use the already-loaded imgRef -----------------
      const el = imgRef.current;
      if (el && el.complete && el.naturalWidth > 0) {
        try {
          const blob = await drawToBlob(el);
          onSave(blob, `${saveFilenameBase}.png`);
          return;
        } catch (err) {
          // Likely a tainted canvas — fall through to path 2.
          console.warn("direct draw failed, falling back to fetch", err);
        }
      }

      // --- Path 2: fetch bytes then redraw via blob: URL ---------
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`fetch ${resp.status}`);
      const blobIn = await resp.blob();
      const objectUrl = URL.createObjectURL(blobIn);
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new window.Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("image load failed"));
          img.src = objectUrl;
        });
        const out = await drawToBlob(image);
        onSave(out, `${saveFilenameBase}.png`);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("save failed", err);
      toast("error", `Save failed: ${msg}`);
    }
  }, [drawAnnotations, onSave, saveFilenameBase, src]);

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

  // Hybrid rendering:
  //  - The <img> is sized in the DOM at FIT dimensions (natural × the
  //    fit-to-container ratio, independent of zoom). At zoom == 1 this
  //    is exactly the on-screen size, so the browser gets to do its
  //    single high-quality downsample pass once.
  //  - Zoom is then applied as a CSS transform `scale(zoom)` which the
  //    compositor can GPU-scale. This means dragging the zoom slider
  //    or spinning the wheel does NOT trigger a re-decode/re-sample of
  //    the image each frame — zooming is smooth even on 4K inputs.
  //  - transform-origin is 0 0 so `translate(box.x, box.y) scale(zoom)`
  //    places the scaled top-left exactly at (box.x, box.y).
  //
  // Before `natural` is known the img still needs to participate in
  // layout so the browser actually downloads it — we hide it with
  // opacity:0 rather than display:none.
  const fitBase = natural && cont.w && cont.h
    ? fitScale(natural.w, natural.h, cont.w, cont.h)
    : 1;
  const fitW = natural ? natural.w * fitBase : 0;
  const fitH = natural ? natural.h * fitBase : 0;
  const imgStyle: React.CSSProperties = box && natural
    ? {
        transform: `translate(${box.x}px, ${box.y}px) scale(${transform.scale})`,
        transformOrigin: "0 0",
        width: `${fitW}px`,
        height: `${fitH}px`,
        imageRendering: transform.scale >= 2 ? "pixelated" : "auto",
        willChange: "transform",
      }
    : {
        opacity: 0,
        pointerEvents: "none",
        maxWidth: "1px",
        maxHeight: "1px",
      };

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
          onError={() => {
            /* ignore — natural will remain null and the "Loading…" state shows */
          }}
          className="absolute top-0 left-0 pointer-events-none"
          style={imgStyle}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-faint p-4 text-center">
          {placeholder ?? "No image — drag & drop a file, or paste a path above"}
        </div>
      )}

      {/* Rectangle overlay rendered ON TOP of the image (z-30) so it
          stays legible when the unified/heatmap layer is active. Each
          rect gets a white halo stroke beneath the coloured stroke for
          contrast, and an always-visible colour chip + label. */}
      {box && boxes.length > 0 && (
        <svg
          className="absolute top-0 left-0 w-full h-full z-30"
          viewBox={`0 0 ${cont.w} ${cont.h}`}
          preserveAspectRatio="none"
          style={{ pointerEvents: "none" }}
        >
          {boxes.map((b, i) => {
            const tl = normalizedToPane(b.x, b.y, box);
            const br = normalizedToPane(b.x + b.w, b.y + b.h, box);
            const rx = Math.min(tl.x, br.x);
            const ry = Math.min(tl.y, br.y);
            const rw = Math.abs(br.x - tl.x);
            const rh = Math.abs(br.y - tl.y);
            const labelText = b.label ?? `Region ${i + 1}`;
            // Label chip sits just above the rect if there's room, else
            // tucked inside its top-left corner.
            const chipAboveY = ry - 16 >= 2 ? ry - 4 : ry + 14;
            const chipX = rx + 4;
            return (
              <g key={b.id}>
                {/* Halo (white) under the coloured stroke. */}
                <rect
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill="none"
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth={4.5}
                />
                <rect
                  x={rx}
                  y={ry}
                  width={rw}
                  height={rh}
                  fill="none"
                  stroke={b.color}
                  strokeWidth={2.5}
                  onClick={(e) => { e.stopPropagation(); if (onDeleteBox) onDeleteBox(b.id); }}
                  style={{ pointerEvents: onDeleteBox ? "auto" : "none", cursor: onDeleteBox ? "pointer" : "default" }}
                />
                {/* Solid colour chip + label. */}
                <rect
                  x={chipX - 3}
                  y={chipAboveY - 11}
                  width={Math.max(36, labelText.length * 6.8 + 14)}
                  height={14}
                  rx={3}
                  fill={b.color}
                  opacity={0.95}
                />
                <text
                  x={chipX + 3}
                  y={chipAboveY}
                  fill="#ffffff"
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                  fontWeight={600}
                  style={{ userSelect: "none" }}
                >
                  {labelText}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {drawRect && (
        <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-30">
          <rect
            x={Math.min(drawRect.x0, drawRect.x1)}
            y={Math.min(drawRect.y0, drawRect.y1)}
            width={Math.abs(drawRect.x1 - drawRect.x0)}
            height={Math.abs(drawRect.y1 - drawRect.y0)}
            fill={`${drawColor}33`}
            stroke="rgba(255,255,255,0.9)"
            strokeWidth={4}
          />
          <rect
            x={Math.min(drawRect.x0, drawRect.x1)}
            y={Math.min(drawRect.y0, drawRect.y1)}
            width={Math.abs(drawRect.x1 - drawRect.x0)}
            height={Math.abs(drawRect.y1 - drawRect.y0)}
            fill="none"
            stroke={drawColor}
            strokeWidth={2}
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
