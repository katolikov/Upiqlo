/**
 * Resolve absolute filesystem paths to URLs the webview can render.
 *
 * In Tauri, `convertFileSrc` rewrites a path like /Users/.../x.png into an
 * `asset://localhost/...`-style URL that the custom protocol handler can
 * serve. In a plain browser dev session (no Tauri), fall back to the
 * engine's `/api/file` passthrough, carrying the bearer token as a query
 * param (browsers can't set Authorization on an <img src>).
 */

import { engineBaseUrl, getEnginePort, withTokenParam } from "./engine";

let cachedConvert: ((path: string) => string) | null = null;

async function loadTauriConvert(): Promise<((p: string) => string) | null> {
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
  if (convert) return convert(path);
  const port = await getEnginePort();
  const base = `${engineBaseUrl(port)}/api/file?path=${encodeURIComponent(path)}`;
  return withTokenParam(base);
}
