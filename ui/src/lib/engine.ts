/**
 * Tauri-side IPC helpers for discovering the Upiqal engine port + token.
 *
 * In production (Tauri), the Rust host reads the two-line handshake from
 * the sidecar and exposes it via the `get_engine_port` / `get_engine_token`
 * commands. In dev (`npm run dev` without Tauri), we fall back to
 * VITE_UPIQAL_ENGINE_PORT / VITE_UPIQAL_ENGINE_TOKEN injected by dev.sh.
 */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function getInvoke(): Promise<InvokeFn | null> {
  try {
    const mod = await import("@tauri-apps/api/core");
    return mod.invoke as InvokeFn;
  } catch {
    return null;
  }
}

function viteEnv(): Record<string, string | undefined> {
  return (import.meta as unknown as { env: Record<string, string | undefined> }).env;
}

let _cachedPort: number | null = null;
let _cachedToken: string | null = null;
// True once we've confirmed we're running inside Tauri at least once, so
// we never silently fall back to a dev default port after that point.
let _tauriConfirmed = false;

export async function getEnginePort(): Promise<number> {
  if (_cachedPort !== null) return _cachedPort;
  const invoke = await getInvoke();
  if (invoke) {
    _tauriConfirmed = true;
    // The Rust host captures the port from the sidecar's stdout handshake
    // asynchronously. Early calls (within the first ~1–3 s after launch)
    // may race and reject with "engine has not announced a port yet".
    // Rethrow WITHOUT caching so the next retry (e.g. TopBar's 5-second
    // poll) actually re-invokes the Tauri command instead of returning a
    // stale dev-default port forever. This bug manifested as a permanent
    // "Engine offline" chip on Windows even though the engine was healthy.
    const port = await invoke<number>("get_engine_port");
    _cachedPort = port;
    return port;
  }
  if (_tauriConfirmed) {
    throw new Error("engine port unavailable (Tauri invoke missing on retry)");
  }
  const fromEnv = viteEnv().VITE_UPIQAL_ENGINE_PORT;
  _cachedPort = fromEnv ? Number(fromEnv) : 51017;
  return _cachedPort;
}

export async function getEngineToken(): Promise<string | null> {
  if (_cachedToken !== null) return _cachedToken;
  const invoke = await getInvoke();
  if (invoke) {
    _tauriConfirmed = true;
    // Same rationale as getEnginePort: propagate the error so the caller's
    // retry loop actually retries instead of locking in a null token.
    const token = await invoke<string>("get_engine_token");
    _cachedToken = token;
    return token;
  }
  if (_tauriConfirmed) {
    return null;
  }
  const fromEnv = viteEnv().VITE_UPIQAL_ENGINE_TOKEN;
  if (fromEnv) {
    _cachedToken = fromEnv;
    return _cachedToken;
  }
  return null;
}

export function engineBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Build the Authorization header for fetch calls. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getEngineToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Append `?token=<token>` to a URL that needs query-string auth (SSE). */
export async function withTokenParam(url: string): Promise<string> {
  const token = await getEngineToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
