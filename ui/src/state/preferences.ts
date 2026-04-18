import { create } from "zustand";
import type { PixelFormat } from "@/lib/image-formats";

/** Per-session tunable parameters. Each session holds its own snapshot. */
export interface Preferences {
  maxSide: number; // 256..2048
  scoreMode: "sigmoid" | "nll";
  pyramid: boolean;
  featureSide: number; // 128..512
  /** RAW-only: user-supplied width for .raw / .bin / .yuv / .nv21 / .nv12. */
  rawWidth?: number | null;
  /** RAW-only: user-supplied height. */
  rawHeight?: number | null;
  /** RAW-only: pixel packing. .nv21 / .nv12 extensions auto-pick this. */
  rawPixelFormat?: PixelFormat | null;
}

interface PreferencesStore extends Preferences {
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

const DEFAULTS: Preferences = {
  maxSide: 1024,
  scoreMode: "sigmoid",
  pyramid: true,
  featureSide: 256,
  rawWidth: null,
  rawHeight: null,
  rawPixelFormat: null,
};

export const usePreferences = create<PreferencesStore>((set) => ({
  ...DEFAULTS,
  update: (patch) => set((s) => ({ ...s, ...patch })),
  reset: () => set({ ...DEFAULTS }),
}));
