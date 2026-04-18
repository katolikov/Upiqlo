/**
 * Render the "Unified" artifact-highlight view on the frontend.
 *
 * Algorithm
 * ---------
 * 1. Load the target image, draw to an offscreen canvas.
 * 2. Convert to grayscale (Rec.601 luminance).
 * 3. For each ENABLED artifact layer, load its mask PNG, tint with a
 *    vibrant colour, and composite over the grayscale base using the
 *    "screen" blend mode so overlapping artefacts mix rather than
 *    overwrite.
 * 4. Return a PNG data URL ready to feed into an <img src>.
 *
 * This is a pure frontend operation — toggling a layer on/off does NOT
 * re-run the heavy ML algorithm. The backend supplies the individual
 * mask PNGs once per comparison; the browser does the compositing.
 */

import { heatmapDataUrl } from "./api";

export type UnifiedArtifact =
  | "global_anomaly_map.png"
  | "structural_similarity_map.png"
  | "color_degradation_map.png"
  | "gibbs_ringing_mask.png"
  | "gaussian_noise_mask.png"
  | "blur_mask.png";

export interface UnifiedLayerSpec {
  key: UnifiedArtifact;
  label: string;
  /** Hex colour used to tint this artefact's mask in the composite. */
  color: string;
  /** 0..1 — multiplier applied to the mask's intensity. */
  intensity?: number;
}

/** The seven artefact channels + the accent colour assigned to each. */
export const UNIFIED_LAYERS: UnifiedLayerSpec[] = [
  { key: "global_anomaly_map.png", label: "Anomaly", color: "#FF1493", intensity: 0.95 },
  { key: "gibbs_ringing_mask.png", label: "Ringing", color: "#00E5FF", intensity: 1.0 },
  { key: "gaussian_noise_mask.png", label: "Noise", color: "#00FF7F", intensity: 1.0 },
  { key: "blur_mask.png", label: "Blur", color: "#FFEA00", intensity: 1.0 },
  { key: "color_degradation_map.png", label: "Color shift", color: "#FF6A00", intensity: 0.85 },
  { key: "structural_similarity_map.png", label: "Structure", color: "#FF00E5", intensity: 0.7 },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src.slice(0, 60)}`));
    img.src = src;
  });
}

function paintGrayscale(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.2989 * r + 0.587 * g + 0.114 * b;
    data[i] = lum;
    data[i + 1] = lum;
    data[i + 2] = lum;
  }
  ctx.putImageData(img, 0, 0);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

/**
 * Tint a mask image with a colour and write the result to `out` using
 * the mask's brightness as the alpha channel. This avoids depending on
 * globalCompositeOperation = 'source-in' which behaves inconsistently
 * across some Tauri webviews.
 */
function paintTintedMask(
  out: CanvasRenderingContext2D,
  mask: HTMLImageElement,
  color: { r: number; g: number; b: number },
  intensity: number,
  width: number,
  height: number,
) {
  const buf = document.createElement("canvas");
  buf.width = width;
  buf.height = height;
  const bctx = buf.getContext("2d");
  if (!bctx) return;
  bctx.drawImage(mask, 0, 0, width, height);
  const img = bctx.getImageData(0, 0, width, height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Brightness-weighted signal (Rec.601) combined with the max-channel —
    // jet colormaps have bright reds/blues that matter even when luminance
    // is low.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const peak = Math.max(r, g, b);
    const alpha = Math.min(255, Math.max(lum, peak) * intensity);
    data[i] = color.r;
    data[i + 1] = color.g;
    data[i + 2] = color.b;
    data[i + 3] = alpha;
  }
  bctx.putImageData(img, 0, 0);
  out.drawImage(buf, 0, 0);
}

export interface BuildUnifiedArgs {
  targetSrc: string;
  heatmaps: Record<string, string>; // layer filename → Base64 PNG
  enabled: Set<string>;
}

/** Build the composite PNG data URL. Returns null if the target image
 * can't be loaded (e.g., comparison hasn't run yet). */
export async function buildUnified({
  targetSrc,
  heatmaps,
  enabled,
}: BuildUnifiedArgs): Promise<string | null> {
  try {
    const base = await loadImage(targetSrc);
    const w = base.naturalWidth;
    const h = base.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    paintGrayscale(ctx, base, w, h);

    // Overlay each enabled layer using the "screen" blend mode so the
    // brighter of base-or-tint wins per pixel — vivid artefacts pop
    // without blowing out unaffected regions.
    ctx.globalCompositeOperation = "screen";
    for (const spec of UNIFIED_LAYERS) {
      if (!enabled.has(spec.key)) continue;
      const b64 = heatmaps[spec.key];
      if (!b64) continue;
      try {
        const mask = await loadImage(heatmapDataUrl(b64));
        paintTintedMask(
          ctx,
          mask,
          hexToRgb(spec.color),
          spec.intensity ?? 1.0,
          w,
          h,
        );
      } catch {
        // Skip missing / unreadable layers.
      }
    }
    ctx.globalCompositeOperation = "source-over";

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
