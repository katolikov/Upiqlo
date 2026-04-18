import type { Transform } from "@/state/viewport";

/**
 * "Fit" scale for an image of natural size (iw × ih) to fit inside a
 * container of size (cw × ch) at its largest without overflowing, keeping
 * aspect ratio. Scale is applied on top of this to zoom further.
 */
export function fitScale(iw: number, ih: number, cw: number, ch: number): number {
  if (!iw || !ih || !cw || !ch) return 1;
  return Math.min(cw / iw, ch / ih);
}

export interface ImageBox {
  /** Top-left x of image content in container coords at the current transform. */
  x: number;
  y: number;
  /** Rendered width/height in container coords. */
  w: number;
  h: number;
}

/**
 * Compute the on-screen box of a centered, fitted image under the given
 * (extra) transform. The base fit layout centers the image; transform
 * scales and pans from that center.
 */
export function imageBox(
  iw: number,
  ih: number,
  cw: number,
  ch: number,
  t: Transform,
): ImageBox {
  const base = fitScale(iw, ih, cw, ch);
  const scale = base * t.scale;
  const w = iw * scale;
  const h = ih * scale;
  const x = (cw - w) / 2 + t.tx;
  const y = (ch - h) / 2 + t.ty;
  return { x, y, w, h };
}

/** Convert container-pane coords → normalized [0,1] image coords. */
export function paneToNormalized(
  paneX: number,
  paneY: number,
  box: ImageBox,
): { x: number; y: number } {
  if (box.w === 0 || box.h === 0) return { x: 0, y: 0 };
  return {
    x: (paneX - box.x) / box.w,
    y: (paneY - box.y) / box.h,
  };
}

/** Convert normalized [0,1] image coords → container-pane coords. */
export function normalizedToPane(
  nx: number,
  ny: number,
  box: ImageBox,
): { x: number; y: number } {
  return { x: box.x + nx * box.w, y: box.y + ny * box.h };
}

/** Clamp a value to [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
