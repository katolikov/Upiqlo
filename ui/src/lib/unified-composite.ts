/**
 * Render the "Unified" artefact-highlight view on the frontend.
 *
 * The base is the target image rendered as GRAYSCALE so the only
 * colour in the final composite comes from the enabled artefact
 * layers. Each enabled mask contributes its spec tint colour on top
 * at pixels whose strength is above a per-layer floor.
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
  // Strength is now max(R,G), so any non-deep-blue jet pixel clears
  // the floor. Intensity < 1 keeps the tint from fully covering the
  // grayscale base so the user can still read what's underneath.
  { key: "global_anomaly_map.png",        label: "Anomaly",     color: "#D6521F", intensity: 0.8, floor: 0.30 },
  { key: "gibbs_ringing_mask.png",        label: "Ringing",     color: "#4F8AA3", intensity: 0.85, floor: 0.30 },
  { key: "gaussian_noise_mask.png",       label: "Noise",       color: "#5F9755", intensity: 0.85, floor: 0.30 },
  { key: "blur_mask.png",                 label: "Blur",        color: "#C58F3B", intensity: 0.85, floor: 0.35 },
  { key: "color_degradation_map.png",     label: "Color shift", color: "#B84A6C", intensity: 0.85, floor: 0.35 },
  // Structural similarity is HIGH where images agree — the anomaly is
  // the blue/low-value region, so invert the strength before thresholding.
  { key: "structural_similarity_map.png", label: "Structure",   color: "#7A5BA6", intensity: 0.85, floor: 0.40, invert: true },
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

/** Load a mask and return its per-pixel strength (0..255) plus the
 * raw RGB (kept for potential future use).
 *
 * Strength is adaptive so both jet-colormapped continuous maps and
 * binary (white-on-black) masks are covered:
 *
 *   - If the pixel is chromatic (channel spread ≥ 40) it came from a
 *     jet colormap. Any non-deep-blue tint is an anomaly — we use
 *     `max(R, G)` as the strength so cyan (anomaly onset), green,
 *     yellow and red all register high, while deep blue (R, G both
 *     low) falls below a typical floor.
 *   - Otherwise the pixel is near-greyscale — a binary mask on black,
 *     so the peak channel equals the mask value.
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
      // Chromatic: max(R, G) — high for cyan / green / yellow / red,
      // low only for deep blue (R small AND G small).
      s = Math.max(r, g);
    } else {
      // Near-grey: binary mask.
      s = Math.max(r, g, b);
    }
    strength[j] = s | 0;
  }
  return { strength, rgb };
}

/** Upper bound on the composite's longest side. The Unified view is
 * purely diagnostic — we don't need per-pixel fidelity at the input's
 * native resolution, and running the per-pixel JS loop on a 4K image
 * takes several seconds. Processing at 1024 px on the long side keeps
 * the composite crisp at typical pane sizes and cuts the work by up
 * to 16× on large inputs. The browser upsamples it when displayed. */
const MAX_COMPOSITE_SIDE = 1024;

export async function buildUnified({
  targetSrc,
  heatmaps,
  enabled,
}: BuildUnifiedArgs): Promise<string | null> {
  try {
    const base = await loadImage(targetSrc);
    const natW = base.naturalWidth;
    const natH = base.naturalHeight;
    const longSide = Math.max(natW, natH);
    const scale = longSide > MAX_COMPOSITE_SIDE ? MAX_COMPOSITE_SIDE / longSide : 1;
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // 1. Paint the target image as GRAYSCALE — the only colour in the
    //    final composite comes from the enabled artefact layers.
    ctx.drawImage(base, 0, 0, w, h);
    const baseImg = ctx.getImageData(0, 0, w, h);
    const baseData = baseImg.data;
    for (let i = 0; i < baseData.length; i += 4) {
      const lum = 0.2989 * baseData[i] + 0.587 * baseData[i + 1] + 0.114 * baseData[i + 2];
      baseData[i] = lum;
      baseData[i + 1] = lum;
      baseData[i + 2] = lum;
    }

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
      // Zero enabled layers → render the target as plain grayscale so
      // the user sees the image content without any colour distraction.
      for (let i = 0; i < baseData.length; i += 4) {
        const lum = 0.2989 * baseData[i] + 0.587 * baseData[i + 1] + 0.114 * baseData[i + 2];
        baseData[i] = lum;
        baseData[i + 1] = lum;
        baseData[i + 2] = lum;
      }
      ctx.putImageData(baseImg, 0, 0);
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
