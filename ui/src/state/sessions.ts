import { create } from "zustand";
import type { CompareReport } from "@/types/report";
import type { FolderScanResponse } from "@/types/folders";
import { usePreferences, type Preferences } from "./preferences";
import { autoSessionName } from "@/lib/session-name";

export type SessionMode = "single" | "folder";

export type CompareStatus =
  | { kind: "idle" }
  | {
      kind: "running";
      startedAt: number;
      stage?: { index: number; total: number; name: string };
      token?: string;
    }
  | { kind: "ok"; report: CompareReport; finishedAt: number }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export type HeatmapLayer =
  | "diagnostic_overlay.png"
  | "anomaly_overlay.png"
  | "global_anomaly_map.png"
  | "structural_similarity_map.png"
  | "color_degradation_map.png"
  | "gibbs_ringing_mask.png"
  | "gaussian_noise_mask.png"
  | "blur_mask.png";

export const HEATMAP_LAYERS: {
  key: HeatmapLayer;
  label: string;
  group: "semantic" | "structural" | "heuristic";
}[] = [
  { key: "diagnostic_overlay.png", label: "Unified", group: "semantic" },
  { key: "anomaly_overlay.png", label: "Anomaly Overlay", group: "semantic" },
  { key: "global_anomaly_map.png", label: "Anomaly Map", group: "semantic" },
  { key: "structural_similarity_map.png", label: "Structure", group: "structural" },
  { key: "color_degradation_map.png", label: "Color", group: "structural" },
  { key: "gibbs_ringing_mask.png", label: "Ringing", group: "heuristic" },
  { key: "gaussian_noise_mask.png", label: "Noise", group: "heuristic" },
  { key: "blur_mask.png", label: "Blur", group: "heuristic" },
];

/** A user-drawn bounding box, stored in normalized image coordinates so it
 * syncs 1:1 across the three workspace panes regardless of render size. */
export interface BoundingBox {
  id: string;
  /** Top-left x in [0, 1] of the image's displayed content. */
  x: number;
  /** Top-left y in [0, 1]. */
  y: number;
  w: number;
  h: number;
  color: string; // hex like "#7A3731"
  label?: string;
}

export interface SingleSession {
  id: string;
  mode: "single";
  title: string;
  createdAt: number;
  referencePath: string | null;
  targetPath: string | null;
  status: CompareStatus;
  layer: HeatmapLayer;
  params: Preferences;
  annotations: BoundingBox[];
}

export interface FolderSession {
  id: string;
  mode: "folder";
  title: string;
  createdAt: number;
  referenceDir: string | null;
  targetDir: string | null;
  scan: FolderScanResponse | null;
  /** Independent selection for the A-side explorer (absolute path). */
  activeReferencePath: string | null;
  /** Independent selection for the B-side explorer (absolute path). */
  activeTargetPath: string | null;
  results: Record<string, CompareStatus>;
  layer: HeatmapLayer;
  params: Preferences;
  /** Annotations keyed by "<ref>|<tgt>" so each (ref, tgt) pick has its own set. */
  annotationsByPair: Record<string, BoundingBox[]>;
}

/** Stable synthetic pair key for the (ref, tgt) selection in Folder mode. */
export function folderPairKey(ref: string | null, tgt: string | null): string {
  return `${ref ?? ""}|${tgt ?? ""}`;
}

export type Session = SingleSession | FolderSession;

/** A compact snapshot stored in localStorage for the Recent Sessions list. */
export interface RecentEntry {
  id: string;
  title: string;
  mode: SessionMode;
  createdAt: number;
  lastOpenedAt: number;
  referencePath?: string | null;
  targetPath?: string | null;
  referenceDir?: string | null;
  targetDir?: string | null;
  params: Preferences;
  lastScore?: number;
  lastDominant?: string;
}

function uid(): string {
  return `sess_${Math.random().toString(36).slice(2, 10)}`;
}

const RECENTS_KEY = "upiqlo.recents.v1";
const RECENTS_MAX = 12;

function loadRecents(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is RecentEntry => !!e && typeof e.id === "string");
  } catch {
    return [];
  }
}

function saveRecents(entries: RecentEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENTS_KEY,
      JSON.stringify(entries.slice(0, RECENTS_MAX)),
    );
  } catch {
    /* quota — acceptable */
  }
}

export function sessionToRecent(s: Session): RecentEntry {
  const base = {
    id: s.id,
    title: s.title,
    mode: s.mode,
    createdAt: s.createdAt,
    lastOpenedAt: Date.now(),
    params: s.params,
  } as RecentEntry;
  if (s.mode === "single") {
    base.referencePath = s.referencePath;
    base.targetPath = s.targetPath;
    if (s.status.kind === "ok") {
      base.lastScore = s.status.report.score;
      base.lastDominant = s.status.report.diagnostics.dominant_artifact;
    }
  } else {
    base.referenceDir = s.referenceDir;
    base.targetDir = s.targetDir;
  }
  return base;
}

/** Build a fresh session (single or folder). Exposed so the Start Screen
 * can hydrate a new session from a Recent Entry. */
export interface SessionSeed {
  id?: string;
  createdAt?: number;
  referencePath?: string | null;
  targetPath?: string | null;
  referenceDir?: string | null;
  targetDir?: string | null;
  annotations?: BoundingBox[];
  annotationsByPair?: Record<string, BoundingBox[]>;
}

export function buildSession(
  mode: SessionMode,
  title: string,
  params: Preferences,
  seed?: SessionSeed,
): Session {
  const id = seed?.id ?? uid();
  const base = {
    id,
    createdAt: seed?.createdAt ?? Date.now(),
    title,
    layer: "diagnostic_overlay.png" as HeatmapLayer,
    params,
  };
  if (mode === "single") {
    return {
      ...base,
      mode: "single",
      referencePath: seed?.referencePath ?? null,
      targetPath: seed?.targetPath ?? null,
      status: { kind: "idle" },
      annotations: seed?.annotations ?? [],
    };
  }
  return {
    ...base,
    mode: "folder",
    referenceDir: seed?.referenceDir ?? null,
    targetDir: seed?.targetDir ?? null,
    scan: null,
    activeReferencePath: null,
    activeTargetPath: null,
    results: {},
    annotationsByPair: seed?.annotationsByPair ?? {},
  };
}

interface SessionStore {
  sessions: Session[];
  activeId: string | null;
  recents: RecentEntry[];

  // lifecycle
  openSession: (mode: SessionMode, title?: string) => string;
  hydrateSession: (session: Session) => string;
  openFromRecent: (entry: RecentEntry) => string;
  closeSession: (id: string) => void;
  setActive: (id: string | null) => void;
  renameSession: (id: string, title: string) => void;

  // single
  setSinglePaths: (id: string, ref: string | null, tgt: string | null) => void;
  setSingleStatus: (
    id: string,
    status: CompareStatus | ((prev: CompareStatus) => CompareStatus),
  ) => void;

  // folder
  setFolderDirs: (id: string, ref: string | null, tgt: string | null) => void;
  setFolderScan: (id: string, scan: FolderScanResponse | null) => void;
  setFolderActiveRef: (id: string, path: string | null) => void;
  setFolderActiveTgt: (id: string, path: string | null) => void;
  setFolderPairStatus: (
    id: string,
    pairId: string,
    status: CompareStatus | ((prev: CompareStatus) => CompareStatus),
  ) => void;

  // shared
  setLayer: (id: string, layer: HeatmapLayer) => void;
  updateParams: (id: string, patch: Partial<Preferences>) => void;
  resetParams: (id: string) => void;

  // annotations
  setAnnotations: (id: string, boxes: BoundingBox[], pairId?: string) => void;
  addAnnotation: (id: string, box: BoundingBox, pairId?: string) => void;
  removeAnnotation: (id: string, boxId: string, pairId?: string) => void;
  updateAnnotation: (
    id: string,
    boxId: string,
    patch: Partial<BoundingBox>,
    pairId?: string,
  ) => void;
  clearAnnotations: (id: string, pairId?: string) => void;

  // recents
  pushRecent: (entry: RecentEntry) => void;
  removeRecent: (id: string) => void;
  clearRecents: () => void;

  // selectors
  getActive: () => Session | null;
  getAnnotations: (id: string, pairId?: string) => BoundingBox[];
}

export const useSessions = create<SessionStore>((set, get) => ({
  sessions: [],
  activeId: null,
  recents: loadRecents(),

  openSession: (mode, title) => {
    const snapshot: Preferences = {
      maxSide: usePreferences.getState().maxSide,
      scoreMode: usePreferences.getState().scoreMode,
      pyramid: usePreferences.getState().pyramid,
      featureSide: usePreferences.getState().featureSide,
    };
    // Auto-name sessions: "<word>_<hash>_<YYYY-MM-DD>".
    const session = buildSession(mode, title ?? autoSessionName(), snapshot);
    set((s) => ({ sessions: [...s.sessions, session], activeId: session.id }));
    return session.id;
  },

  hydrateSession: (session) => {
    set((s) => {
      const exists = s.sessions.some((sess) => sess.id === session.id);
      const nextSessions = exists
        ? s.sessions.map((sess) => (sess.id === session.id ? session : sess))
        : [...s.sessions, session];
      return { sessions: nextSessions, activeId: session.id };
    });
    return session.id;
  },

  openFromRecent: (entry) => {
    const snapshot: Preferences = { ...entry.params };
    const seed: SessionSeed = {
      referencePath: entry.referencePath ?? null,
      targetPath: entry.targetPath ?? null,
      referenceDir: entry.referenceDir ?? null,
      targetDir: entry.targetDir ?? null,
    };
    const session = buildSession(entry.mode, entry.title, snapshot, seed);
    set((s) => ({ sessions: [...s.sessions, session], activeId: session.id }));
    // Refresh the lastOpenedAt on the recent entry.
    const refreshed: RecentEntry = { ...entry, lastOpenedAt: Date.now() };
    get().pushRecent(refreshed);
    return session.id;
  },

  closeSession: (id) => {
    const { sessions, activeId } = get();
    // Save to recents before removing.
    const sess = sessions.find((s) => s.id === id);
    if (sess) {
      const hasContent =
        (sess.mode === "single" && (sess.referencePath || sess.targetPath)) ||
        (sess.mode === "folder" && (sess.referenceDir || sess.targetDir));
      if (hasContent) get().pushRecent(sessionToRecent(sess));
    }
    const next = sessions.filter((s) => s.id !== id);
    const nextActive = activeId === id ? (next[next.length - 1]?.id ?? null) : activeId;
    set({ sessions: next, activeId: nextActive });
  },

  setActive: (id) => set({ activeId: id }),

  renameSession: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, title } : sess)),
    })),

  setSinglePaths: (id, ref, tgt) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.mode === "single"
          ? { ...sess, referencePath: ref, targetPath: tgt }
          : sess,
      ),
    })),

  setSingleStatus: (id, status) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== id || sess.mode !== "single") return sess;
        const next = typeof status === "function" ? status(sess.status) : status;
        // Push to recents when a run completes successfully.
        if (next.kind === "ok" && sess.status.kind !== "ok") {
          queueMicrotask(() =>
            get().pushRecent(sessionToRecent({ ...sess, status: next })),
          );
        }
        return { ...sess, status: next };
      }),
    })),

  setFolderDirs: (id, ref, tgt) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.mode === "folder"
          ? {
              ...sess,
              referenceDir: ref,
              targetDir: tgt,
              scan: null,
              results: {},
              activeReferencePath: null,
              activeTargetPath: null,
            }
          : sess,
      ),
    })),

  setFolderScan: (id, scan) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== id || sess.mode !== "folder") return sess;
        // Keep any prior A/B selection if those files still exist in the
        // fresh scan; otherwise clear.
        const refFiles = scan
          ? new Set([
              ...scan.pairs.map((p) => p.reference_path),
              ...scan.unmatched_reference,
            ])
          : null;
        const tgtFiles = scan
          ? new Set([
              ...scan.pairs.map((p) => p.target_path),
              ...scan.unmatched_target,
            ])
          : null;
        return {
          ...sess,
          scan,
          results: {},
          activeReferencePath:
            refFiles && sess.activeReferencePath && refFiles.has(sess.activeReferencePath)
              ? sess.activeReferencePath
              : null,
          activeTargetPath:
            tgtFiles && sess.activeTargetPath && tgtFiles.has(sess.activeTargetPath)
              ? sess.activeTargetPath
              : null,
        };
      }),
    })),

  setFolderActiveRef: (id, path) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.mode === "folder"
          ? { ...sess, activeReferencePath: path }
          : sess,
      ),
    })),

  setFolderActiveTgt: (id, path) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.mode === "folder"
          ? { ...sess, activeTargetPath: path }
          : sess,
      ),
    })),

  setFolderPairStatus: (id, pairId, status) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== id || sess.mode !== "folder") return sess;
        const prev = sess.results[pairId] ?? { kind: "idle" };
        const next = typeof status === "function" ? status(prev) : status;
        if (next.kind === "ok" && prev.kind !== "ok") {
          queueMicrotask(() => get().pushRecent(sessionToRecent(sess)));
        }
        return { ...sess, results: { ...sess.results, [pairId]: next } };
      }),
    })),

  setLayer: (id, layer) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, layer } : sess)),
    })),

  updateParams: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? ({ ...sess, params: { ...sess.params, ...patch } } as Session) : sess,
      ),
    })),

  resetParams: (id) => {
    const fresh: Preferences = {
      maxSide: usePreferences.getState().maxSide,
      scoreMode: usePreferences.getState().scoreMode,
      pyramid: usePreferences.getState().pyramid,
      featureSide: usePreferences.getState().featureSide,
    };
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? ({ ...sess, params: fresh } as Session) : sess,
      ),
    }));
  },

  // ------------------------- annotations -------------------------
  setAnnotations: (id, boxes, pairId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== id) return sess;
        if (sess.mode === "single") return { ...sess, annotations: boxes };
        const key = pairId ?? "__none__";
        return {
          ...sess,
          annotationsByPair: { ...sess.annotationsByPair, [key]: boxes },
        };
      }),
    })),

  addAnnotation: (id, box, pairId) => {
    const curr = get().getAnnotations(id, pairId);
    get().setAnnotations(id, [...curr, box], pairId);
  },

  removeAnnotation: (id, boxId, pairId) => {
    const curr = get().getAnnotations(id, pairId);
    get().setAnnotations(id, curr.filter((b) => b.id !== boxId), pairId);
  },

  updateAnnotation: (id, boxId, patch, pairId) => {
    const curr = get().getAnnotations(id, pairId);
    const next = curr.map((b) => (b.id === boxId ? { ...b, ...patch } : b));
    get().setAnnotations(id, next, pairId);
  },

  clearAnnotations: (id, pairId) => get().setAnnotations(id, [], pairId),

  // ------------------------- recents -------------------------
  pushRecent: (entry) => {
    set((s) => {
      const filtered = s.recents.filter((r) => r.id !== entry.id);
      const next = [entry, ...filtered].slice(0, RECENTS_MAX);
      saveRecents(next);
      return { recents: next };
    });
  },

  removeRecent: (id) => {
    set((s) => {
      const next = s.recents.filter((r) => r.id !== id);
      saveRecents(next);
      return { recents: next };
    });
  },

  clearRecents: () => {
    saveRecents([]);
    set({ recents: [] });
  },

  // ------------------------- selectors -------------------------
  getActive: () => {
    const { sessions, activeId } = get();
    return sessions.find((s) => s.id === activeId) ?? null;
  },

  getAnnotations: (id, pairId) => {
    const sess = get().sessions.find((s) => s.id === id);
    if (!sess) return [];
    if (sess.mode === "single") return sess.annotations;
    const key = pairId ?? "__none__";
    return sess.annotationsByPair[key] ?? [];
  },
}));
