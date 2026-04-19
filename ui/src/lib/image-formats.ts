/**
 * Image-format metadata shared between the UI and the engine.
 *
 * Keep in sync with `engine/upiqal_engine/folders.py::IMAGE_EXTS` and
 * the upstream algorithm's `_PIXEL_FORMATS` (NV21 / NV12 / GRAY8 / RGB888).
 */

export type PixelFormat = "NV21" | "NV12" | "GRAY8" | "RGB888";

export const PIXEL_FORMATS: PixelFormat[] = ["RGB888", "GRAY8", "NV21", "NV12"];

/** File extensions that `folders.scan` surfaces into the explorer lists. */
export const SUPPORTED_IMAGE_EXTS: readonly string[] = [
  ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp",
  ".npy",
  ".raw", ".bin", ".yuv",
  ".nv21", ".nv12",
] as const;

/** Extensions where the file itself encodes its dimensions + pixel format
 * (no user input required). */
export const AUTO_DETECT_EXTS = new Set<string>([
  ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp", ".npy",
]);

/** Extensions that imply a specific pixel_format from the name alone. */
export const IMPLIED_PIXEL_FORMAT: Record<string, PixelFormat> = {
  ".nv21": "NV21",
  ".nv12": "NV12",
};

/** True when this file needs user-supplied width/height/pixel_format
 * (generic raw byte stream with no self-describing header). */
export function needsRawConfig(path: string | null | undefined): boolean {
  if (!path) return false;
  const ext = extname(path);
  if (AUTO_DETECT_EXTS.has(ext)) return false;
  if (ext in IMPLIED_PIXEL_FORMAT) {
    // NV21/NV12 need width + height even though the pixel_format is implied.
    return true;
  }
  // .raw / .bin / .yuv / anything else we whitelist below — require full config.
  if (ext === ".raw" || ext === ".bin" || ext === ".yuv") return true;
  return false;
}

/** True when we can infer pixel_format from the extension (still need w/h). */
export function impliedPixelFormat(path: string | null | undefined): PixelFormat | null {
  if (!path) return null;
  return IMPLIED_PIXEL_FORMAT[extname(path)] ?? null;
}

export function extname(path: string): string {
  const i = path.lastIndexOf(".");
  if (i < 0) return "";
  return path.slice(i).toLowerCase();
}

export function basename(path: string | null | undefined): string {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Filter a list of file paths to the supported image extensions. */
export function filterSupportedImages(paths: string[]): string[] {
  const allow = new Set(SUPPORTED_IMAGE_EXTS);
  return paths.filter((p) => allow.has(extname(p)));
}
