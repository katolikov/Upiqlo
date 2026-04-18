/**
 * Session Save / Open — serialises an Upiqlo session into a portable JSON
 * document with the `.upiqlo` extension.
 *
 * The document captures everything needed to recreate the session on a
 * different machine (assuming the image files exist at the same absolute
 * paths — or, for truly-portable archives, the file paths are replaced
 * with Base64 payloads when `embedImages=true`). For now we keep the
 * simpler path-reference form which is what the spec calls for:
 * "pack the file paths, configuration parameters, drawn annotations, and
 *  output metrics into an archive/file".
 */

import type { Session, SingleSession, FolderSession } from "@/state/sessions";
import { buildSession } from "@/state/sessions";
import type { Preferences } from "@/state/preferences";

export const SESSION_FILE_VERSION = 1;

export interface UpiqloSessionDocV1 {
  version: 1;
  kind: "upiqlo-session";
  exportedAt: string; // ISO timestamp
  session: {
    mode: "single" | "folder";
    title: string;
    createdAt: number;
    params: Preferences;
    layer: string;
    single?: {
      referencePath: string | null;
      targetPath: string | null;
      annotations: import("@/state/sessions").BoundingBox[];
      // Optional cached metrics from the last successful run.
      lastMetrics?: {
        score: number;
        score_label: string;
        diagnostics: import("@/types/report").Diagnostics;
        image_resolution: { width: number; height: number };
      };
    };
    folder?: {
      referenceDir: string | null;
      targetDir: string | null;
      activePairIndex: number;
      annotationsByPair: Record<string, import("@/state/sessions").BoundingBox[]>;
    };
  };
}

export function exportSession(s: Session): UpiqloSessionDocV1 {
  const out: UpiqloSessionDocV1 = {
    version: 1,
    kind: "upiqlo-session",
    exportedAt: new Date().toISOString(),
    session: {
      mode: s.mode,
      title: s.title,
      createdAt: s.createdAt,
      params: s.params,
      layer: s.layer,
    },
  };
  if (s.mode === "single") {
    out.session.single = {
      referencePath: s.referencePath,
      targetPath: s.targetPath,
      annotations: s.annotations,
    };
    if (s.status.kind === "ok") {
      const r = s.status.report;
      out.session.single.lastMetrics = {
        score: r.score,
        score_label: r.score_label,
        diagnostics: r.diagnostics,
        image_resolution: r.image_resolution,
      };
    }
  } else {
    out.session.folder = {
      referenceDir: s.referenceDir,
      targetDir: s.targetDir,
      activePairIndex: s.activePairIndex,
      annotationsByPair: s.annotationsByPair,
    };
  }
  return out;
}

export function importSession(doc: UpiqloSessionDocV1): Session {
  if (doc.version !== 1 || doc.kind !== "upiqlo-session") {
    throw new Error("Unsupported session-file format");
  }
  const s = doc.session;
  if (s.mode === "single") {
    const single = s.single ?? {
      referencePath: null,
      targetPath: null,
      annotations: [],
    };
    const sess = buildSession("single", s.title, s.params, {
      referencePath: single.referencePath,
      targetPath: single.targetPath,
      annotations: single.annotations,
    }) as SingleSession;
    sess.layer = (s.layer as SingleSession["layer"]) ?? sess.layer;
    if (single.lastMetrics) {
      // Attach the cached metrics so the dashboard renders immediately on import.
      sess.status = {
        kind: "ok",
        finishedAt: Date.now(),
        report: {
          score: single.lastMetrics.score,
          score_label: single.lastMetrics.score_label,
          reference_image: single.referencePath ?? "",
          target_image: single.targetPath ?? "",
          image_resolution: single.lastMetrics.image_resolution,
          diagnostics: single.lastMetrics.diagnostics,
          heatmaps: {}, // Not persisted — user can rerun to regenerate.
          params: {
            max_side: s.params.maxSide,
            score_mode: s.params.scoreMode,
            pyramid: s.params.pyramid,
            feature_side: s.params.featureSide,
            width: null,
            height: null,
            pixel_format: null,
          },
        },
      };
    }
    return sess;
  }
  const folder = s.folder ?? {
    referenceDir: null,
    targetDir: null,
    activePairIndex: 0,
    annotationsByPair: {},
  };
  const sess = buildSession("folder", s.title, s.params, {
    referenceDir: folder.referenceDir,
    targetDir: folder.targetDir,
    annotationsByPair: folder.annotationsByPair,
  }) as FolderSession;
  sess.layer = (s.layer as FolderSession["layer"]) ?? sess.layer;
  sess.activePairIndex = folder.activePairIndex;
  return sess;
}

/** Browser-side download of a .upiqlo file. */
export function downloadUpiqloFile(doc: UpiqloSessionDocV1, filename: string) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".upiqlo") ? filename : `${filename}.upiqlo`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Triggers a hidden <input type="file"> to read a .upiqlo document. */
export function pickUpiqloFile(): Promise<UpiqloSessionDocV1 | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".upiqlo,.json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = reader.result as string;
          const doc = JSON.parse(text) as UpiqloSessionDocV1;
          resolve(doc);
        } catch (e) {
          console.error("failed to parse .upiqlo:", e);
          resolve(null);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}
