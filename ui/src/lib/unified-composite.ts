/**
 * Render the "Unified" artefact-highlight view on the frontend.
 *
 * The base image is rendered as darkened grayscale. Each enabled mask
 * contributes strength only where it is above a per-layer floor. At
 * each pixel we pick the *strongest* layer and tint with its colour
 * (winner-takes-all). Non-artefact regions stay grayscale, keeping the
 * output legible rather than muddy from stacked translucent masks.
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
  { key: "structural_similarity_map.png", label: "Structure",   color: "#7A5BA6", intensity: 1.0, floor: 0.50 },
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Extract a per-pixel scalar strength (0..255) from a colour mask. */
function extractStrength(
  img: HTMLImageElement,
  w: number,
  h: number,
): Uint8Array {
  const buf = document.createElement("canvas");
  buf.width = w;
  buf.height = h;
  const ctx = buf.getContext("2d");
  if (!ctx) return new Uint8Array(w * h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const peak = Math.max(r, g, b);
    // Works for both binary masks and jet-colourmapped continuous heatmaps.
    out[j] = Math.max(lum, peak) | 0;
  }
  return out;
}

export interface BuildUnifiedArgs {
  targetSrc: string;
  heatmaps: Record<string, string>;
  enabled: Set<string>;
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

    // 1. Paint a darkened grayscale base so artefact tints pop.
    ctx.drawImage(base, 0, 0, w, h);
    const baseImg = ctx.getImageData(0, 0, w, h);
    const baseData = baseImg.data;
    for (let i = 0; i < baseData.length; i += 4) {
      const r = baseData[i];
      const g = baseData[i + 1];
      const b = baseData[i + 2];
      const lum = 0.2989 * r + 0.587 * g + 0.114 * b;
      const dim = lum * 0.7;
      baseData[i] = dim;
      baseData[i + 1] = dim;
      baseData[i + 2] = dim;
    }

    // 2. Extract per-pixel strength for each enabled mask.
    const layers: {
      spec: UnifiedLayerSpec;
      strength: Uint8Array;
      rgb: { r: number; g: number; b: number };
    }[] = [];
    for (const spec of UNIFIED_LAYERS) {
      if (!enabled.has(spec.key)) continue;
      const b64 = heatmaps[spec.key];
      if (!b64) continue;
      try {
        const mask = await loadImage(heatmapDataUrl(b64));
        layers.push({
          spec,
          strength: extractStrength(mask, w, h),
          rgb: hexToRgb(spec.color),
        });
      } catch {
        /* unreadable mask → skip */
      }
    }

    if (layers.length === 0) {
      ctx.putImageData(baseImg, 0, 0);
      return canvas.toDataURL("image/png");
    }

    // 3. Winner-takes-all per pixel: above-floor max wins, gets tinted.
    const N = w * h;
    for (let p = 0, i = 0; p < N; p += 1, i += 4) {
      let bestAlpha = 0;
      let bestR = 0, bestG = 0, bestB = 0;
      for (const L of layers) {
        const s = L.strength[p] / 255;
        const floor = L.spec.floor ?? 0.35;
        if (s <= floor) continue;
        const intensity = L.spec.intensity ?? 1.0;
        const rescaled = Math.min(
          1,
          (s - floor) / Math.max(1 / 255, 1 - floor),
        );
        const a = rescaled * intensity;
        if (a > bestAlpha) {
          bestAlpha = a;
          bestR = L.rgb.r;
          bestG = L.rgb.g;
          bestB = L.rgb.b;
        }
      }
      if (bestAlpha > 0) {
        const a = Math.min(0.85, bestAlpha);
        const inv = 1 - a;
        baseData[i] = bestR * a + baseData[i] * inv;
        baseData[i + 1] = bestG * a + baseData[i + 1] * inv;
        baseData[i + 2] = bestB * a + baseData[i + 2] * inv;
      }
    }
    ctx.putImageData(baseImg, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
