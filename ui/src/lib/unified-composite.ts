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
  { key: "global_anomaly_map.png",        label: "Anomaly",     color: "#D6521F", intensity: 1.0, floor: 0.35 },
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
 * RGB (from the jet colormap or binary white mask).
 *
 * Strength extraction is adaptive per pixel:
 *   - If the pixel is roughly chromatic (channel spread ≥ 40), it's
 *     from a jet colourmap. In jet, low values are blue / cyan and
 *     high values are yellow / red — the anomaly axis is R − B. We
 *     encode that as `max(0, min(255, (R − B) + 128))` so pure blue
 *     maps to 0, green to ~128, and yellow/red to 255.
 *   - Otherwise the pixel is greyscale (binary mask on black), and
 *     we use the peak channel directly.
 *
 * This makes the blue half of the jet colormap fall BELOW the floor
 * automatically, so the target image shows through untinted there —
 * which is what the user expects ("apply only where it's not blue").
 */
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
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    let s: number;
    if (spread >= 40) {
      // Jet-ish chromatic pixel: R − B axis (blue low, red high).
      s = r - b + 128;
      if (s < 0) s = 0;
      else if (s > 255) s = 255;
    } else {
      // Near-greyscale pixel: use peak channel (binary white on black).
      s = Math.max(r, g, b);
    }
    strength[j] = s | 0;
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

    // 3. For each pixel, alpha-composite each enabled mask over the
    //    base with alpha = rescaled strength-above-floor. Every layer
    //    tints with its spec colour (the same swatch shown in the
    //    legend chip) — the jet colormap's per-pixel RGB is no longer
    //    used, so hotspots are legible regardless of the underlying
    //    colormap. Invert layers (Structure) still flip their strength
    //    before the floor check, so they only contribute in their
    //    blue / low-similarity regions.
    const specRgb = new Map<string, { r: number; g: number; b: number }>();
    for (const L of layers) {
      const c = L.spec.color.replace("#", "");
      specRgb.set(L.spec.key, {
        r: parseInt(c.slice(0, 2), 16),
        g: parseInt(c.slice(2, 4), 16),
        b: parseInt(c.slice(4, 6), 16),
      });
    }
    const N = w * h;
    for (let p = 0, i = 0; p < N; p += 1, i += 4) {
      for (const L of layers) {
        const raw = L.strength[p] / 255;
        const s = L.spec.invert ? 1 - raw : raw;
        const floor = L.spec.floor ?? 0.35;
        if (s <= floor) continue;
        const intensity = L.spec.intensity ?? 1.0;
        // Alpha is the strength directly (not rescaled across the
        // [floor..1] range). With a steep rescale, moderate anomalies
        // like a mid-strength green jet pixel just above the floor
        // would be painted at a few percent alpha and effectively
        // disappear, hiding real secondary hotspots. Using the raw
        // strength keeps mid-anomaly regions visible while still
        // letting reds pop at ~90 %.
        const a = Math.min(0.9, s * intensity);
        const inv = 1 - a;
        const c = specRgb.get(L.spec.key)!;
        baseData[i]     = c.r * a + baseData[i]     * inv;
        baseData[i + 1] = c.g * a + baseData[i + 1] * inv;
        baseData[i + 2] = c.b * a + baseData[i + 2] * inv;
      }
    }
    ctx.putImageData(baseImg, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
