import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useViewport } from "@/state/viewport";

interface Props {
  sessionId: string;
  src: string | null;
  label: string;
  placeholder?: string;
  className?: string;
}

/**
 * Zoomable / pannable image pane.
 *
 * All three workspace panes share the same session-scoped `Transform`,
 * so dragging or wheel-zooming one updates the others in lock-step.
 */
export function ImagePane({ sessionId, src, label, placeholder, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const t = useViewport((s) => s.transforms[sessionId] ?? { scale: 1, tx: 0, ty: 0 });
  const zoomBy = useViewport((s) => s.zoomBy);
  const panBy = useViewport((s) => s.panBy);
  const reset = useViewport((s) => s.reset);
  const [dragging, setDragging] = useState(false);

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

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      panBy(sessionId, e.movementX, e.movementY);
    },
    [dragging, panBy, sessionId],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  const onDoubleClick = useCallback(() => reset(sessionId), [reset, sessionId]);

  // Intentionally non-passive wheel listener (React handles passive by default).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`;

  return (
    <div
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      className={cn(
        "relative flex-1 overflow-hidden bg-surface-sunken select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      title="Drag to pan · wheel to zoom · double-click to reset"
    >
      <div className="absolute top-2 left-2 z-10 px-2 py-0.5 text-[11px] font-medium text-text-muted bg-surface/80 backdrop-blur rounded border border-surface-border">
        {label}
      </div>

      {src ? (
        <img
          src={src}
          alt={label}
          draggable={false}
          className="absolute top-1/2 left-1/2 max-w-none pointer-events-none"
          style={{
            transform: `translate(-50%, -50%) ${transform}`,
            transformOrigin: "center center",
            imageRendering: "pixelated",
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-faint">
          {placeholder ?? "No image"}
        </div>
      )}
    </div>
  );
}
