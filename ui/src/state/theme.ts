import { useEffect } from "react";
import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";

const KEY = "upiqal.theme.v1";

function loadTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

function saveTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    /* ignore */
  }
}

interface ThemeStore {
  mode: ThemeMode;
  effective: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
}

function systemPref(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  const m = window.matchMedia?.("(prefers-color-scheme: light)");
  return m?.matches ? "light" : "dark";
}

function resolve(mode: ThemeMode): "light" | "dark" {
  return mode === "system" ? systemPref() : mode;
}

export const useTheme = create<ThemeStore>((set) => ({
  mode: loadTheme(),
  effective: resolve(loadTheme()),
  setMode: (mode) => {
    saveTheme(mode);
    set({ mode, effective: resolve(mode) });
  },
}));

/**
 * Apply the current theme to <html class="…"> so Tailwind's
 * `darkMode: "class"` strategy flips the palette. Call once at mount.
 */
export function useApplyTheme() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  useEffect(() => {
    const el = document.documentElement;
    const eff = resolve(mode);
    el.classList.remove("light", "dark");
    el.classList.add(eff);
    el.dataset.theme = eff;
    // Keep the store in sync if "system" pref changes.
    if (mode !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const listener = () => setMode("system");
    mq.addEventListener?.("change", listener);
    return () => mq.removeEventListener?.("change", listener);
  }, [mode, setMode]);
}
