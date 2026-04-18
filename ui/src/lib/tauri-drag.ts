import { isTauri } from "./assets";

type DragHandler = (paths: string[]) => void;
type UnlistenFn = () => void;

let listenerPromise: Promise<UnlistenFn> | null = null;
const handlers = new Set<DragHandler>();

async function ensureListener(): Promise<void> {
  if (listenerPromise) return;
  if (!isTauri()) return;
  listenerPromise = (async () => {
    try {
      // Tauri v2 drag-drop events are emitted by the window at
      // `tauri://drag-drop`. The payload has { type: 'drop', paths: [...] }.
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const webview = getCurrentWebview();
      const unlisten = await webview.onDragDropEvent((event) => {
        const payload = event.payload as { type?: string; paths?: string[] };
        if (payload && payload.type === "drop" && Array.isArray(payload.paths)) {
          const paths = payload.paths;
          for (const h of handlers) h(paths);
        }
      });
      return unlisten;
    } catch (err) {
      console.warn("tauri-drag: failed to attach listener:", err);
      return () => {};
    }
  })();
}

/** Register a handler for OS-level file drops. Returns an unsubscribe fn. */
export function onTauriFileDrop(h: DragHandler): () => void {
  handlers.add(h);
  void ensureListener();
  return () => {
    handlers.delete(h);
  };
}
