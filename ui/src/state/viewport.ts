import { create } from "zustand";

/**
 * Shared pan/zoom transform for the three workspace panes.
 *
 * All three ImagePanes read the same transform, so moving one moves them
 * all. Per-session so switching tabs doesn't leak zoom state.
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
  zoomBy: (sessionId: string, factor: number, cx: number, cy: number) => void;
  panBy: (sessionId: string, dx: number, dy: number) => void;
}

const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

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
  zoomBy: (sessionId, factor, cx, cy) =>
    set((s) => {
      const t = s.transforms[sessionId] ?? IDENTITY;
      const newScale = clampScale(t.scale * factor);
      const k = newScale / t.scale;
      // Keep the point (cx, cy) in pane coords stationary.
      const tx = cx - k * (cx - t.tx);
      const ty = cy - k * (cy - t.ty);
      return { transforms: { ...s.transforms, [sessionId]: { scale: newScale, tx, ty } } };
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
