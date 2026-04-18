/**
 * Tauri-side IPC helpers for discovering the Upiqlo engine port + token.
 *
 * In production (Tauri), the Rust host reads the two-line handshake from
 * the sidecar and exposes it via the `get_engine_port` / `get_engine_token`
 * commands. In dev (`npm run dev` without Tauri), we fall back to
 * VITE_UPIQLO_ENGINE_PORT / VITE_UPIQLO_ENGINE_TOKEN injected by dev.sh.
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

export async function getEnginePort(): Promise<number> {
  if (_cachedPort !== null) return _cachedPort;
  const invoke = await getInvoke();
  if (invoke) {
    try {
      _cachedPort = await invoke<number>("get_engine_port");
      return _cachedPort;
    } catch (err) {
      console.warn("get_engine_port via Tauri failed, falling back:", err);
    }
  }
  const fromEnv = viteEnv().VITE_UPIQLO_ENGINE_PORT;
  _cachedPort = fromEnv ? Number(fromEnv) : 51017;
  return _cachedPort;
}

export async function getEngineToken(): Promise<string | null> {
  if (_cachedToken !== null) return _cachedToken;
  const invoke = await getInvoke();
  if (invoke) {
    try {
      _cachedToken = await invoke<string>("get_engine_token");
      return _cachedToken;
    } catch (err) {
      console.warn("get_engine_token via Tauri failed, falling back:", err);
    }
  }
  const fromEnv = viteEnv().VITE_UPIQLO_ENGINE_TOKEN;
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
