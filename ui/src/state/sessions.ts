import { create } from "zustand";
import type { CompareReport } from "@/types/report";
import type { FolderScanResponse, FolderPair } from "@/types/folders";
import { usePreferences, type Preferences } from "./preferences";

export type SessionMode = "single" | "folder";

export type CompareStatus =
  | { kind: "idle" }
  | {
      kind: "running";
      startedAt: number;
      /** Latest stage progress; undefined before first [N/M] event. */
      stage?: { index: number; total: number; name: string };
      /** Cancellation token from the engine's SSE `open` handshake. */
      token?: string;
    }
  | { kind: "ok"; report: CompareReport; finishedAt: number }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** Which sub-tab is active in the middle pane. Blocking mask was removed
 * from upstream's PNG output list (severity is still reported in the
 * bottom dashboard's Blocking bar). */
export type HeatmapLayer =
  | "diagnostic_overlay.png"
  | "anomaly_overlay.png"
  | "global_anomaly_map.png"
  | "structural_similarity_map.png"
  | "color_degradation_map.png"
  | "gibbs_ringing_mask.png"
  | "gaussian_noise_mask.png"
  | "blur_mask.png";

export const HEATMAP_LAYERS: { key: HeatmapLayer; label: string; group: "semantic" | "structural" | "heuristic" }[] = [
  // Unified diagnostic overlay — all artefact channels composited on one image
  // (added in upstream FR-IQA-Algo commit a611d41).
  { key: "diagnostic_overlay.png", label: "Unified", group: "semantic" },
  { key: "anomaly_overlay.png", label: "Overlay", group: "semantic" },
  { key: "global_anomaly_map.png", label: "Anomaly", group: "semantic" },
  { key: "structural_similarity_map.png", label: "Structure", group: "structural" },
  { key: "color_degradation_map.png", label: "Color", group: "structural" },
  { key: "gibbs_ringing_mask.png", label: "Ringing", group: "heuristic" },
  { key: "gaussian_noise_mask.png", label: "Noise", group: "heuristic" },
  { key: "blur_mask.png", label: "Blur", group: "heuristic" },
];

export interface SingleSession {
  id: string;
  mode: "single";
  title: string;
  createdAt: number;
  referencePath: string | null;
  targetPath: string | null;
  status: CompareStatus;
  layer: HeatmapLayer;
  /** Per-session parameter snapshot. Initialised from globals at openSession
   * time, then edited through the TopBar while this session is active. */
  params: Preferences;
}

export interface FolderSession {
  id: string;
  mode: "folder";
  title: string;
  createdAt: number;
  referenceDir: string | null;
  targetDir: string | null;
  scan: FolderScanResponse | null;
  activePairIndex: number;
  /** Results keyed by pair_id (folder-session scoped). */
  results: Record<string, CompareStatus>;
  layer: HeatmapLayer;
  params: Preferences;
}

export type Session = SingleSession | FolderSession;

function uid(): string {
  return `sess_${Math.random().toString(36).slice(2, 10)}`;
}

interface SessionStore {
  sessions: Session[];
  activeId: string | null;

  // lifecycle
  openSession: (mode: SessionMode, title?: string) => string;
  closeSession: (id: string) => void;
  setActive: (id: string) => void;
  renameSession: (id: string, title: string) => void;

  // single-mode mutations
  setSinglePaths: (id: string, ref: string | null, tgt: string | null) => void;
  setSingleStatus: (
    id: string,
    status: CompareStatus | ((prev: CompareStatus) => CompareStatus),
  ) => void;

  // folder-mode mutations
  setFolderDirs: (id: string, ref: string | null, tgt: string | null) => void;
  setFolderScan: (id: string, scan: FolderScanResponse | null) => void;
  setFolderActivePair: (id: string, index: number) => void;
  setFolderPairStatus: (
    id: string,
    pairId: string,
    status: CompareStatus | ((prev: CompareStatus) => CompareStatus),
  ) => void;

  // shared
  setLayer: (id: string, layer: HeatmapLayer) => void;
  updateParams: (id: string, patch: Partial<Preferences>) => void;
  resetParams: (id: string) => void;

  // selectors
  getActive: () => Session | null;
  getFolderActivePair: (id: string) => FolderPair | null;
}

export const useSessions = create<SessionStore>((set, get) => ({
  sessions: [],
  activeId: null,

  openSession: (mode, title) => {
    const id = uid();
    // Snapshot current global Preferences so each tab has its own editable
    // parameter set that doesn't leak into sibling tabs.
    const snapshot: Preferences = {
      maxSide: usePreferences.getState().maxSide,
      scoreMode: usePreferences.getState().scoreMode,
      pyramid: usePreferences.getState().pyramid,
      featureSide: usePreferences.getState().featureSide,
    };
    const base = {
      id,
      createdAt: Date.now(),
      title: title ?? (mode === "single" ? "New Comparison" : "New Folder Compare"),
      layer: "diagnostic_overlay.png" as HeatmapLayer,
      params: snapshot,
    };
    const session: Session =
      mode === "single"
        ? {
            ...base,
            mode: "single",
            referencePath: null,
            targetPath: null,
            status: { kind: "idle" },
          }
        : {
            ...base,
            mode: "folder",
            referenceDir: null,
            targetDir: null,
            scan: null,
            activePairIndex: 0,
            results: {},
          };
    set((s) => ({ sessions: [...s.sessions, session], activeId: id }));
    return id;
  },

  closeSession: (id) => {
    const { sessions, activeId } = get();
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
        return { ...sess, status: next };
      }),
    })),

  setFolderDirs: (id, ref, tgt) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.mode === "folder"
          ? { ...sess, referenceDir: ref, targetDir: tgt, scan: null, results: {}, activePairIndex: 0 }
          : sess,
      ),
    })),

  setFolderScan: (id, scan) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.mode === "folder"
          ? { ...sess, scan, activePairIndex: 0, results: {} }
          : sess,
      ),
    })),

  setFolderActivePair: (id, index) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id && sess.mode === "folder"
          ? { ...sess, activePairIndex: Math.max(0, index) }
          : sess,
      ),
    })),

  setFolderPairStatus: (id, pairId, status) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== id || sess.mode !== "folder") return sess;
        const prev = sess.results[pairId] ?? { kind: "idle" };
        const next = typeof status === "function" ? status(prev) : status;
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

  getActive: () => {
    const { sessions, activeId } = get();
    return sessions.find((s) => s.id === activeId) ?? null;
  },

  getFolderActivePair: (id) => {
    const sess = get().sessions.find((s) => s.id === id);
    if (!sess || sess.mode !== "folder" || !sess.scan) return null;
    return sess.scan.pairs[sess.activePairIndex] ?? null;
  },
}));

export function pairIdFor(pair: FolderPair): string {
  return pair.label;
}
