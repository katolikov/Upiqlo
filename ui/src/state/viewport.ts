import { create } from "zustand";

/**
 * Per-session pan / zoom transform for the three workspace panes.
 *
 * Semantics:
 *   - `scale` is relative to the image's "fit-to-container" scale. At
 *     scale === 1 the image exactly fits without overflow, centered.
 *   - `tx`, `ty` are the pixel offset applied ON TOP of the centered-fit
 *     layout. Default (0, 0) keeps the image centered.
 *
 * Zoom at cursor derivation:
 *   Image left edge = (cw - w)/2 + tx   where w = iw * fit * scale.
 *   To keep (cx, cy) stationary under a scale change (k = new/old):
 *     new_left = cx - k * (cx - left)
 *   ⇒ new_tx = (1 - k) * (cx - cw/2) + k * tx
 */

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

interface ViewportStore {
  transforms: Record<string, Transform>;
  get: (sessionId: string) => Transform;
  set: (sessionId: string, t: Transform) => void;
  reset: (sessionId: string) => void;
  /** Zoom anchored at container coords (cx, cy); cw/ch are container size. */
  zoomAt: (
    sessionId: string,
    factor: number,
    cx: number,
    cy: number,
    cw: number,
    ch: number,
  ) => void;
  panBy: (sessionId: string, dx: number, dy: number) => void;
}

export const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

function clampScale(s: number): number {
  return Math.max(0.1, Math.min(16, s));
}

export const useViewport = create<ViewportStore>((set, getState) => ({
  transforms: {},
  get: (sessionId) => getState().transforms[sessionId] ?? IDENTITY,
  set: (sessionId, t) =>
    set((s) => ({ transforms: { ...s.transforms, [sessionId]: t } })),
  reset: (sessionId) =>
    set((s) => ({ transforms: { ...s.transforms, [sessionId]: { ...IDENTITY } } })),
  zoomAt: (sessionId, factor, cx, cy, cw, ch) =>
    set((s) => {
      const t = s.transforms[sessionId] ?? IDENTITY;
      const newScale = clampScale(t.scale * factor);
      const k = newScale / t.scale;
      if (k === 1) return s;
      const new_tx = (1 - k) * (cx - cw / 2) + k * t.tx;
      const new_ty = (1 - k) * (cy - ch / 2) + k * t.ty;
      return {
        transforms: {
          ...s.transforms,
          [sessionId]: { scale: newScale, tx: new_tx, ty: new_ty },
        },
      };
    }),
  panBy: (sessionId, dx, dy) =>
    set((s) => {
      const t = s.transforms[sessionId] ?? IDENTITY;
      return {
        transforms: {
          ...s.transforms,
          [sessionId]: { ...t, tx: t.tx + dx, ty: t.ty + dy },
        },
      };
    }),
}));
