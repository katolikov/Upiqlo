/**
 * Build a single PNG that stitches together the Left, Output and
 * Right panes side-by-side, with the MetricsDashboard footer burnt in
 * at the bottom, and write it to the target image's directory.
 *
 * Used by the session header's "Save All" button so a user can ship
 * one artefact that summarises the full comparison (inputs + the
 * visualisation they currently see in the Output pane + the numbers).
 */

import { isTauri } from "@/lib/assets";
import type { CompareReport } from "@/types/report";
import type { BoundingBox } from "@/state/sessions";

const FOOTER_H = 140;

/** Draw annotation rectangles (halo + coloured stroke + label chip) in
 * the sub-rectangle `(ox, oy, w, h)` of the combined canvas. Matches
 * the per-pane ImageCanvas treatment so the saved file looks like
 * what was on screen. */
function drawAnnotationsOn(
  ctx: CanvasRenderingContext2D,
  boxes: BoundingBox[],
  ox: number,
  oy: number,
  w: number,
  h: number,
): void {
  const stroke = Math.max(2, Math.round(Math.min(w, h) / 400));
  ctx.save();
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const labelText = b.label ?? `Region ${i + 1}`;
    const rx = ox + b.x * w;
    const ry = oy + b.y * h;
    const rw = b.w * w;
    const rh = b.h * h;
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.lineWidth = stroke;
    ctx.strokeStyle = b.color;
    ctx.strokeRect(rx, ry, rw, rh);
    const fontPx = Math.max(11, Math.round(h / 70));
    ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
    const textW = ctx.measureText(labelText).width;
    ctx.fillStyle = b.color;
    ctx.fillRect(rx, ry - fontPx - 6, textW + 12, fontPx + 6);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(labelText, rx + 6, ry - 6);
  }
  ctx.restore();
}

function shortHash(): string {
  return Math.random().toString(36).slice(2, 10);
}

function destinationFor(targetPath: string, variant?: string): string {
  const sep = targetPath.includes("\\") && !targetPath.includes("/") ? "\\" : "/";
  const lastSepIx = Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\"));
  const dir = lastSepIx >= 0 ? targetPath.slice(0, lastSepIx) : "";
  const file = lastSepIx >= 0 ? targetPath.slice(lastSepIx + 1) : targetPath;
  const dotIx = file.lastIndexOf(".");
  const stem = dotIx > 0 ? file.slice(0, dotIx) : file;
  const hash = shortHash();
  const suffix = variant ? `_${hash}_upiqal_combined_${variant}` : `_${hash}_upiqal_combined`;
  const filename = `${stem}${suffix}.png`;
  return dir ? `${dir}${sep}${filename}` : filename;
}

async function loadBytesAsImage(src: string): Promise<HTMLImageElement> {
  // fetch + blob URL so asset:// and http:// both produce a
  // same-origin image that won't taint the canvas.
  const resp = await fetch(src);
  if (!resp.ok) throw new Error(`fetch ${src}: ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`decode failed for ${src}`));
      img.src = url;
    });
  } finally {
    // keep the blob URL alive long enough for drawImage; revoke after
    // the caller finishes the composite.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  imgW: number,
  imgY: number,
  footerH: number,
  report: CompareReport,
): void {
  const y0 = imgY;
  ctx.fillStyle = "#1a1612";
  ctx.fillRect(0, y0, imgW, footerH);
  ctx.fillStyle = "#3a3230";
  ctx.fillRect(0, y0, imgW, 1);

  const padX = 24;
  const padY = 18;
  const labelSize = Math.max(10, Math.round(footerH * 0.1));
  const valueSize = Math.max(18, Math.round(footerH * 0.22));

  const severities: [string, number][] = [];
  const sev = report.diagnostics.severity_scores;
  if (sev.blocking !== undefined) severities.push(["JPEG Blocking", sev.blocking]);
  if (sev.ringing !== undefined) severities.push(["Gibbs Ringing", sev.ringing]);
  if (sev.noise !== undefined) severities.push(["Gaussian Noise", sev.noise]);
  if (sev.color_shift !== undefined) severities.push(["Color Shift", sev.color_shift]);
  if (sev.blur !== undefined) severities.push(["Blur", sev.blur]);

  const leftW = Math.min(480, imgW * 0.28);
  const rightW = Math.min(220, imgW * 0.14);
  const midW = imgW - leftW - rightW - padX * 2;
  const colW = severities.length > 0 ? midW / severities.length : 0;

  let x = padX;
  ctx.fillStyle = "#8f857a";
  ctx.font = `${labelSize}px system-ui, sans-serif`;
  ctx.fillText("FR-IQA SCORE", x, y0 + padY + labelSize);
  const scoreColor =
    report.score >= 0.75 ? "#6aa36b" : report.score >= 0.45 ? "#c48a42" : "#c85b5b";
  ctx.fillStyle = scoreColor;
  ctx.font = `bold ${valueSize}px system-ui, sans-serif`;
  ctx.fillText(report.score.toFixed(3), x, y0 + padY + labelSize + valueSize + 4);
  ctx.fillStyle = "#c8c0b2";
  ctx.font = `${labelSize + 2}px system-ui, sans-serif`;
  ctx.fillText(
    `${report.score_label} · ${report.diagnostics.dominant_artifact}`,
    x,
    y0 + padY + labelSize + valueSize + labelSize + 16,
  );

  x = padX + leftW;
  severities.forEach(([name, value], i) => {
    const cx = x + i * colW;
    ctx.fillStyle = "#8f857a";
    ctx.font = `${labelSize}px system-ui, sans-serif`;
    ctx.fillText(name.toUpperCase(), cx, y0 + padY + labelSize);
    ctx.fillStyle = "#ede6d9";
    ctx.font = `bold ${valueSize - 4}px system-ui, sans-serif`;
    ctx.fillText(value.toFixed(1), cx, y0 + padY + labelSize + valueSize);
    const barY = y0 + padY + labelSize + valueSize + 10;
    const barW = colW - 16;
    ctx.fillStyle = "#2a2420";
    ctx.fillRect(cx, barY, barW, 6);
    const clamped = Math.max(0, Math.min(100, value));
    const barColor =
      clamped >= 70 ? "#c85b5b" : clamped >= 40 ? "#c48a42" : clamped >= 15 ? "#6aa36b" : "#4f7a4f";
    ctx.fillStyle = barColor;
    ctx.fillRect(cx, barY, barW * (clamped / 100), 6);
  });

  const { width, height } = report.image_resolution;
  x = imgW - padX - rightW;
  ctx.fillStyle = "#8f857a";
  ctx.font = `${labelSize}px system-ui, sans-serif`;
  ctx.fillText("RESOLUTION", x, y0 + padY + labelSize);
  ctx.fillStyle = "#ede6d9";
  ctx.font = `bold ${valueSize - 4}px system-ui, sans-serif`;
  ctx.fillText(`${width}×${height}`, x, y0 + padY + labelSize + valueSize);
  ctx.fillStyle = "#6a625a";
  ctx.font = `${labelSize}px system-ui, sans-serif`;
  ctx.fillText(
    "Upiqlo · FR-IQA",
    x,
    y0 + padY + labelSize + valueSize + labelSize + 16,
  );
}

export interface SaveCombinedArgs {
  /** Absolute filesystem path of the target image — output is written
   * next to this file. */
  targetPath: string;
  leftSrc: string;
  middleSrc: string;
  rightSrc: string;
  /** Labels rendered as a caption above each pane. */
  labels?: { left: string; middle: string; right: string };
  /** Optional metrics footer. Omit to save just the three panes. */
  report?: CompareReport | null;
  /** Suffix between the hash and the extension, e.g. `anomaly_map`. */
  variant?: string;
  /** Annotations to burn into every pane (they're stored in normalised
   * [0, 1] coordinates, so the same list renders correctly on all
   * three panes regardless of their individual sizes). */
  annotations?: BoundingBox[];
}

/**
 * Main entry point. Returns the absolute path of the written file
 * (Tauri) or null (browser fallback triggers a download).
 */
export async function saveCombinedImage({
  targetPath,
  leftSrc,
  middleSrc,
  rightSrc,
  labels,
  report = null,
  variant,
  annotations,
}: SaveCombinedArgs): Promise<{ blob: Blob; writtenPath: string | null; filename: string }> {
  const [L, M, R] = await Promise.all([
    loadBytesAsImage(leftSrc),
    loadBytesAsImage(middleSrc),
    loadBytesAsImage(rightSrc),
  ]);

  // Normalise each pane to the same height (the max of the three), so
  // the side-by-side composite has a clean top / bottom edge.
  const H = Math.max(L.naturalHeight, M.naturalHeight, R.naturalHeight);
  const scale = (img: HTMLImageElement) => H / img.naturalHeight;
  const lW = Math.round(L.naturalWidth * scale(L));
  const mW = Math.round(M.naturalWidth * scale(M));
  const rW = Math.round(R.naturalWidth * scale(R));

  const LABEL_H = labels ? 40 : 0;
  const totalW = lW + mW + rW;
  const totalH = LABEL_H + H + (report ? FOOTER_H : 0);

  const canvas = document.createElement("canvas");
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  // Dark band behind labels for readability.
  if (labels) {
    ctx.fillStyle = "#1a1612";
    ctx.fillRect(0, 0, totalW, LABEL_H);
    ctx.fillStyle = "#ede6d9";
    ctx.font = `bold ${Math.round(LABEL_H * 0.45)}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const centers = [lW / 2, lW + mW / 2, lW + mW + rW / 2];
    const names = [labels.left, labels.middle, labels.right];
    names.forEach((name, i) => {
      const text = name;
      const tw = ctx.measureText(text).width;
      ctx.fillText(text, centers[i] - tw / 2, LABEL_H / 2);
    });
  }

  ctx.drawImage(L, 0, LABEL_H, lW, H);
  ctx.drawImage(M, lW, LABEL_H, mW, H);
  ctx.drawImage(R, lW + mW, LABEL_H, rW, H);

  // Annotations are in normalised image coords, so we can draw them
  // at the same relative position in each pane's sub-rectangle.
  if (annotations && annotations.length > 0) {
    drawAnnotationsOn(ctx, annotations, 0, LABEL_H, lW, H);
    drawAnnotationsOn(ctx, annotations, lW, LABEL_H, mW, H);
    drawAnnotationsOn(ctx, annotations, lW + mW, LABEL_H, rW, H);
  }

  // Separator lines between panes.
  ctx.fillStyle = "#3a3230";
  ctx.fillRect(lW, LABEL_H, 1, H);
  ctx.fillRect(lW + mW, LABEL_H, 1, H);

  if (report) drawFooter(ctx, totalW, LABEL_H + H, FOOTER_H, report);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) throw new Error("toBlob returned null");

  if (isTauri()) {
    const dst = destinationFor(targetPath, variant);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fs = await import("@tauri-apps/plugin-fs");
    await fs.writeFile(dst, bytes);
    const filename = dst.split(/[\\/]/).pop() ?? dst;
    return { blob, writtenPath: dst, filename };
  }

  // Browser fallback.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = destinationFor("output.png", variant).split(/[\\/]/).pop() ?? "combined.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { blob, writtenPath: null, filename: a.download };
}
