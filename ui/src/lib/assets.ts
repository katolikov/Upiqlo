/**
 * Resolve absolute filesystem paths to URLs the webview can render.
 *
 * In Tauri production, `convertFileSrc` rewrites `/Users/.../x.png` into
 * `asset://localhost/<encoded-path>` which the custom `asset:` protocol
 * handler (configured in `tauri.conf.json`'s `assetProtocol` scope) serves
 * as a normal image. In a plain browser dev session (no Tauri), fall back
 * to the engine's `/api/file` passthrough with the bearer token as a
 * query parameter (browsers can't set Authorization on an <img src>).
 */

import { engineBaseUrl, getEnginePort, withTokenParam } from "./engine";

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
  isTauri?: boolean;
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as TauriWindow;
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.isTauri);
}

let cachedConvert: ((path: string) => string) | null = null;

async function loadTauriConvert(): Promise<((p: string) => string) | null> {
  if (!isTauri()) return null;
  if (cachedConvert) return cachedConvert;
  try {
    const mod = await import("@tauri-apps/api/core");
    cachedConvert = (mod.convertFileSrc as unknown) as (p: string) => string;
    return cachedConvert;
  } catch {
    return null;
  }
}

export async function resolveImageSrc(path: string | null): Promise<string | null> {
  if (!path) return null;
  const convert = await loadTauriConvert();
  if (convert) {
    // Tauri's asset protocol needs an absolute path.
    try {
      return convert(path);
    } catch (e) {
      console.warn("convertFileSrc failed, falling back to /api/file:", e);
    }
  }
  const port = await getEnginePort();
  const base = `${engineBaseUrl(port)}/api/file?path=${encodeURIComponent(path)}`;
  return withTokenParam(base);
}
