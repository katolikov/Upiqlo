import { authHeaders, engineBaseUrl, getEnginePort, withTokenParam } from "./engine";
import type { CompareReport } from "@/types/report";
import type { ComparePathsPayload } from "./api";

export interface StreamStage {
  index: number;
  total: number;
  name: string;
}

export type StreamEvent =
  | { type: "open"; token: string }
  | { type: "stage"; stage: StreamStage }
  | { type: "result"; report: CompareReport }
  | { type: "done" }
  | { type: "cancelled"; token: string }
  | { type: "error"; message: string };

/**
 * Stream a comparison from /api/compare-paths/stream.
 *
 * Returns a handle with a `cancel()` method. Cancellation fires:
 *   1. `DELETE /api/compare/<token>` to SIGKILL the backend subprocess.
 *   2. The local AbortController, tearing down our SSE reader.
 *
 * Never throws — every outcome (success, error, cancelled, network drop)
 * arrives through the callback with the appropriate `type`.
 */
export function streamCompare(
  payload: ComparePathsPayload,
  onEvent: (evt: StreamEvent) => void,
): { cancel: () => Promise<void> } {
  const controller = new AbortController();
  let token: string | null = null;
  let deleted = false;

  const deleteRun = async () => {
    if (deleted || !token) return;
    deleted = true;
    try {
      const port = await getEnginePort();
      const auth = await authHeaders();
      await fetch(`${engineBaseUrl(port)}/api/compare/${encodeURIComponent(token)}`, {
        method: "DELETE",
        headers: auth,
      });
    } catch {
      // best-effort; the parent subprocess-kill is idempotent on the server side.
    }
  };

  (async () => {
    const port = await getEnginePort();
    const auth = await authHeaders();
    let resp: Response;
    try {
      resp = await fetch(`${engineBaseUrl(port)}/api/compare-paths/stream`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onEvent({ type: "error", message: (err as Error).message });
      }
      return;
    }

    if (!resp.ok || !resp.body) {
      let detail = `stream returned ${resp.status}`;
      try {
        const j = await resp.json();
        detail = j.detail ?? detail;
      } catch {
        /* ignore */
      }
      onEvent({ type: "error", message: detail });
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are delimited by double newlines.
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          let eventName = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith(":")) continue;
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }
          if (dataLines.length === 0) continue;

          let parsed: unknown;
          try {
            parsed = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }

          switch (eventName) {
            case "open": {
              token = (parsed as { token: string }).token;
              onEvent({ type: "open", token });
              break;
            }
            case "stage": {
              onEvent({ type: "stage", stage: parsed as StreamStage });
              break;
            }
            case "result": {
              onEvent({ type: "result", report: parsed as CompareReport });
              break;
            }
            case "done": {
              onEvent({ type: "done" });
              return;
            }
            case "cancelled": {
              onEvent({ type: "cancelled", token: (parsed as { token: string }).token });
              return;
            }
            case "error": {
              onEvent({
                type: "error",
                message: (parsed as { message?: string }).message ?? "unknown engine error",
              });
              return;
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      onEvent({ type: "error", message: (err as Error).message });
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  })();

  return {
    cancel: async () => {
      // Fire server-side SIGKILL first (frees CPU), then abort our reader.
      await deleteRun();
      controller.abort();
    },
  };
}

export async function cancelStreamByToken(token: string): Promise<boolean> {
  const port = await getEnginePort();
  const auth = await authHeaders();
  const url = await withTokenParam(
    `${engineBaseUrl(port)}/api/compare/${encodeURIComponent(token)}`,
  );
  const resp = await fetch(url, { method: "DELETE", headers: auth });
  if (!resp.ok) return false;
  const body = (await resp.json()) as { cancelled: boolean };
  return body.cancelled;
}
