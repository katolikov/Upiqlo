/**
 * Render the "Unified" artefact-highlight view on the frontend.
 *
 * The base is the target image in full colour (un-darkened). Each
 * enabled mask contributes its *own* jet-colormap colours on top, but
 * only at pixels whose strength is above a per-layer floor — below
 * floor contributes alpha 0 so the target shows through untinted.
 *
 * For structural similarity (where blue == anomaly) the layer is
 * marked `invert: true` and its strength is flipped before thresholding.
 *
 * Multiple enabled layers stack with straight source-over compositing.
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
  /** 0..1 — mask values below this are treated as "no artefact" (zero
   * alpha). Raise to strip the low-value tail of the jet colourmap. */
  floor?: number;
  /** For layers where LOW (blue) means artefact — structural similarity
   * is high where the reference and target agree, so the "anomaly"
   * is the blue/low-value region. Setting invert: true flips the
   * strength before the floor check. */
  invert?: boolean;
}

/**
 * Professional palette: each artefact gets a distinct, comfortably
 * saturated hue (no neon). Keep in sync with BOX_COLORS in ImageCanvas
 * where relevant.
 */
export const UNIFIED_LAYERS: UnifiedLayerSpec[] = [
  { key: "global_anomaly_map.png",        label: "Anomaly",     color: "#D6521F", intensity: 1.0, floor: 0.45 },
  { key: "gibbs_ringing_mask.png",        label: "Ringing",     color: "#4F8AA3", intensity: 1.0, floor: 0.35 },
  { key: "gaussian_noise_mask.png",       label: "Noise",       color: "#5F9755", intensity: 1.0, floor: 0.35 },
  { key: "blur_mask.png",                 label: "Blur",        color: "#C58F3B", intensity: 1.0, floor: 0.40 },
  { key: "color_degradation_map.png",     label: "Color shift", color: "#B84A6C", intensity: 1.0, floor: 0.40 },
  // Structural similarity is HIGH where images agree — the anomaly is
  // the blue/low-value region, so invert the strength before thresholding.
  { key: "structural_similarity_map.png", label: "Structure",   color: "#7A5BA6", intensity: 1.0, floor: 0.50, invert: true },
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

export interface BuildUnifiedArgs {
  targetSrc: string;
  heatmaps: Record<string, string>;
  enabled: Set<string>;
}

/** Load a mask and return both its strength channel and its per-pixel
 * RGB (from the jet colormap or binary white mask). */
function extractMaskRGBA(
  img: HTMLImageElement,
  w: number,
  h: number,
): { strength: Uint8Array; rgb: Uint8ClampedArray } {
  const buf = document.createElement("canvas");
  buf.width = w;
  buf.height = h;
  const ctx = buf.getContext("2d");
  const rgb = new Uint8ClampedArray(w * h * 3);
  const strength = new Uint8Array(w * h);
  if (!ctx) return { strength, rgb };
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0, j = 0, k = 0; i < data.length; i += 4, j += 1, k += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    rgb[k] = r;
    rgb[k + 1] = g;
    rgb[k + 2] = b;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const peak = Math.max(r, g, b);
    strength[j] = Math.max(lum, peak) | 0;
  }
  return { strength, rgb };
}

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

    // 1. Paint the target image in full colour as the base. Pixels
    //    where no layer exceeds its floor will show the target as-is.
    ctx.drawImage(base, 0, 0, w, h);
    const baseImg = ctx.getImageData(0, 0, w, h);
    const baseData = baseImg.data;

    // 2. Load each enabled mask with both its strength channel AND
    //    its original per-pixel RGB (jet colours).
    const layers: {
      spec: UnifiedLayerSpec;
      strength: Uint8Array;
      rgb: Uint8ClampedArray;
    }[] = [];
    for (const spec of UNIFIED_LAYERS) {
      if (!enabled.has(spec.key)) continue;
      const b64 = heatmaps[spec.key];
      if (!b64) continue;
      try {
        const mask = await loadImage(heatmapDataUrl(b64));
        const { strength, rgb } = extractMaskRGBA(mask, w, h);
        layers.push({ spec, strength, rgb });
      } catch {
        /* unreadable mask → skip */
      }
    }

    if (layers.length === 0) {
      return canvas.toDataURL("image/png");
    }

    // 3. For each pixel, alpha-composite each enabled mask's ORIGINAL
    //    jet colours over the base, with alpha = rescaled strength-
    //    above-floor. Below-floor pixels contribute alpha 0 → the
    //    target image shows through untinted.
    const N = w * h;
    for (let p = 0, i = 0, k = 0; p < N; p += 1, i += 4, k += 3) {
      for (const L of layers) {
        const raw = L.strength[p] / 255;
        const s = L.spec.invert ? 1 - raw : raw;
        const floor = L.spec.floor ?? 0.35;
        if (s <= floor) continue;
        const intensity = L.spec.intensity ?? 1.0;
        const rescaled = Math.min(
          1,
          (s - floor) / Math.max(1 / 255, 1 - floor),
        );
        const a = Math.min(0.9, rescaled * intensity);
        const inv = 1 - a;
        baseData[i]     = L.rgb[k]     * a + baseData[i]     * inv;
        baseData[i + 1] = L.rgb[k + 1] * a + baseData[i + 1] * inv;
        baseData[i + 2] = L.rgb[k + 2] * a + baseData[i + 2] * inv;
      }
    }
    ctx.putImageData(baseImg, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
