/**
 * TypeScript mirror of the response returned by the Upiqal engine's
 * /api/compare and /api/compare-paths endpoints.
 */

export type DominantArtifact =
  | "None"
  | "JPEG Blocking"
  | "Gibbs Ringing"
  | "Gaussian Noise"
  | "Blur"
  | "Color Shift"
  | string;

export interface SeverityScores {
  ringing: number;
  noise: number;
  color_shift: number;
  blur: number;
  /** Upstream commit a611d41 removed this from the user-visible severity
   * table (still computed internally); keep as optional so older results
   * in cache still render cleanly. */
  blocking?: number;
}

export interface Diagnostics {
  dominant_artifact: DominantArtifact;
  severity_scores: SeverityScores;
  affected_area: number;
}

export interface CompareParamsEcho {
  max_side: number;
  score_mode: "sigmoid" | "nll";
  pyramid: boolean;
  feature_side: number;
  width: number | null;
  height: number | null;
  pixel_format: string | null;
}

export interface CompareReport {
  score: number;
  score_label: string;
  reference_image: string;
  target_image: string;
  image_resolution: { height: number; width: number };
  diagnostics: Diagnostics;
  /** Base64-encoded PNG data, keyed by heatmap filename. */
  heatmaps: Record<string, string>;
  params: CompareParamsEcho;
}
