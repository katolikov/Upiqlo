import { create } from "zustand";

/** Global UI preferences mirrored in the top parameter bar. */
export interface Preferences {
  maxSide: number; // 256..2048
  scoreMode: "sigmoid" | "nll";
  pyramid: boolean;
  featureSide: number; // 128..512
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
};

export const usePreferences = create<PreferencesStore>((set) => ({
  ...DEFAULTS,
  update: (patch) => set((s) => ({ ...s, ...patch })),
  reset: () => set({ ...DEFAULTS }),
}));
