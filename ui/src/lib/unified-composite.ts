/**
 * Render the "Unified" artifact-highlight view on the frontend.
 *
 * The base image is rendered 100% untinted in grayscale. Only pixels
 * that the backend identifies as artefacts above a configurable floor
 * pick up colour — regions with no detected artefact stay pure gray.
 *
 * All layer compositing is done in the browser so toggling a layer on
 * or off is instantaneous (no heavy algorithm re-run).
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
   * alpha), so non-artefact regions stay pure grayscale. Prevents the
   * low-value tail of the jet colourmap from tinting the whole image. */
  floor?: number;
}

/**
 * Professional palette: each artefact gets a distinct, comfortably
 * saturated hue (no neon). Keep in sync with BOX_COLORS in ImageCanvas
 * where relevant.
 */
export const UNIFIED_LAYERS: UnifiedLayerSpec[] = [
  { key: "global_anomaly_map.png", label: "Anomaly", color: "#D6521F", intensity: 1.05, floor: 0.3 },
  { key: "gibbs_ringing_mask.png", label: "Ringing", color: "#4F8AA3", intensity: 1.0, floor: 0.25 },
  { key: "gaussian_noise_mask.png", label: "Noise", color: "#5F9755", intensity: 1.0, floor: 0.25 },
  { key: "blur_mask.png", label: "Blur", color: "#C58F3B", intensity: 1.0, floor: 0.3 },
  { key: "color_degradation_map.png", label: "Color shift", color: "#B84A6C", intensity: 0.9, floor: 0.3 },
  { key: "structural_similarity_map.png", label: "Structure", color: "#7A5BA6", intensity: 0.8, floor: 0.4 },
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
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Paint a mask layer tinted with `color`. Pixels whose mask brightness is
 * below `floor` contribute alpha = 0, keeping the grayscale base visible
 * in those regions. Everything above the floor is rescaled to [0, 255]
 * and scaled by `intensity`.
 */
function paintTintedMask(
  out: CanvasRenderingContext2D,
  mask: HTMLImageElement,
  color: { r: number; g: number; b: number },
  intensity: number,
  floor: number,
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
  const denom = Math.max(1 / 255, 1 - floor);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const peak = Math.max(r, g, b) / 255;
    const raw = Math.max(lum, peak); // 0..1
    // Below-floor → zero alpha (no tint applied). Above-floor → linearly
    // rescaled to [0, 1] then * intensity * 255 → alpha.
    const above = Math.max(0, raw - floor) / denom;
    const alpha = Math.min(255, above * intensity * 255);
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

    paintGrayscale(ctx, base, w, h);

    // Stack each enabled mask with alpha-compositing. With the floor +
    // rescale, non-artefact pixels stay at alpha=0 so the grayscale
    // base shows through. The "source-over" default blend is sufficient;
    // later masks sit on top of earlier ones.
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
          spec.floor ?? 0.25,
          w,
          h,
        );
      } catch {
        /* skip unreadable mask */
      }
    }

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
