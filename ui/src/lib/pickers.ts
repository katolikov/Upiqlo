/**
 * Filesystem pickers with a graceful browser fallback.
 *
 * In the Tauri webview we use the real native dialogs (`@tauri-apps/plugin-
 * dialog`). When running Vite standalone (e.g. `npm run dev:ui` in the
 * browser for quick iteration), the plugin import fails and we fall back
 * to a manual prompt — tests can also call these functions with a
 * preconfigured override.
 */

type OpenFn = (opts: {
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}) => Promise<string | string[] | null>;

async function getOpen(): Promise<OpenFn | null> {
  try {
    const mod = await import("@tauri-apps/plugin-dialog");
    return mod.open as unknown as OpenFn;
  } catch {
    return null;
  }
}

const IMAGE_FILTER = {
  name: "Images",
  extensions: ["png", "jpg", "jpeg", "bmp", "tif", "tiff", "webp"],
};

export async function pickImageFile(title: string): Promise<string | null> {
  const open = await getOpen();
  if (open) {
    const result = await open({ multiple: false, filters: [IMAGE_FILTER], title });
    return typeof result === "string" ? result : null;
  }
  const manual = window.prompt(`${title}\nEnter absolute path:`);
  return manual ? manual : null;
}

export async function pickDirectory(title: string): Promise<string | null> {
  const open = await getOpen();
  if (open) {
    const result = await open({ directory: true, multiple: false, title });
    return typeof result === "string" ? result : null;
  }
  const manual = window.prompt(`${title}\nEnter absolute directory path:`);
  return manual ? manual : null;
}
