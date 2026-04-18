import { authHeaders, engineBaseUrl, getEnginePort } from "./engine";
import type { CompareReport } from "@/types/report";
import type { FolderScanResponse, PairingMode } from "@/types/folders";
import type { PixelFormat } from "./image-formats";

export interface HealthResponse {
  status: "ok";
  version: string;
  algorithm_available: boolean;
}

export interface CompareParamsPayload {
  max_side?: number;
  score_mode?: "sigmoid" | "nll";
  pyramid?: boolean;
  feature_side?: number;
  /** RAW-only input shape. Omit (or leave null) for PNG/JPG/TIFF/etc. */
  width?: number | null;
  height?: number | null;
  pixel_format?: PixelFormat | null;
}

async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  const port = await getEnginePort();
  const url = `${engineBaseUrl(port)}${path}`;
  const auth = await authHeaders();
  const mergedHeaders: Record<string, string> = {
    ...auth,
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const resp = await fetch(url, { ...init, headers: mergedHeaders });
  if (!resp.ok) {
    let detail: string;
    try {
      const body = await resp.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      detail = await resp.text();
    }
    throw new Error(`${path} → ${resp.status}: ${detail}`);
  }
  return resp;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const resp = await engineFetch("/healthz", { signal });
  return (await resp.json()) as HealthResponse;
}

export interface ComparePathsPayload {
  reference_path: string;
  target_path: string;
  session_id?: string;
  pair_id?: string;
  params?: CompareParamsPayload;
}

export async function compareByPaths(
  payload: ComparePathsPayload,
  signal?: AbortSignal,
): Promise<CompareReport> {
  const resp = await engineFetch("/api/compare-paths", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  return (await resp.json()) as CompareReport;
}

export async function scanFolders(
  reference_dir: string,
  target_dir: string,
  mode: PairingMode = "filename",
  signal?: AbortSignal,
): Promise<FolderScanResponse> {
  const resp = await engineFetch("/api/folders/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference_dir, target_dir, mode }),
    signal,
  });
  return (await resp.json()) as FolderScanResponse;
}

export async function fetchCachedReport(
  session_id: string,
  pair_id: string,
  signal?: AbortSignal,
): Promise<CompareReport | null> {
  try {
    const port = await getEnginePort();
    const auth = await authHeaders();
    const resp = await fetch(
      `${engineBaseUrl(port)}/api/report/${encodeURIComponent(session_id)}/${encodeURIComponent(pair_id)}`,
      { headers: auth, signal },
    );
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`report lookup failed: ${resp.status}`);
    return (await resp.json()) as CompareReport;
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return null;
  }
}

/** Build a data URL usable in <img src=...> from Base64 PNG data. */
export function heatmapDataUrl(b64: string): string {
  return `data:image/png;base64,${b64}`;
}
