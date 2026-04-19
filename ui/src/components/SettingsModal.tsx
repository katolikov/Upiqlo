import { useCallback, useEffect } from "react";
import { ExternalLink, Laptop, Moon, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type ThemeMode } from "@/state/theme";
import { isTauri } from "@/lib/assets";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Open a URL in the user's default browser. Inside Tauri the webview
 * would otherwise try to navigate to the URL itself; the shell plugin's
 * `open()` hands it off to the OS. Falls back to `window.open` outside
 * Tauri (e.g. the plain-browser dev session).
 */
async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const mod = await import("@tauri-apps/plugin-shell");
      await mod.open(url);
      return;
    } catch (err) {
      console.warn("shell.open failed, falling back to window.open", err);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Centered modal with theme picker + About section. */
export function SettingsModal({ open, onClose }: Props) {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-raised border border-surface-border rounded-lg shadow-2xl w-full max-w-lg overflow-hidden animate-modal-in"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-surface-border">
          <h2 className="text-sm font-semibold tracking-wide text-text">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text hover:bg-surface"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-6">
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-2">
              Appearance
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <ThemeCard
                active={mode === "light"}
                onClick={() => setMode("light")}
                icon={<Sun size={16} />}
                label="Light"
                subtitle="FR-IQA parchment"
              />
              <ThemeCard
                active={mode === "dark"}
                onClick={() => setMode("dark")}
                icon={<Moon size={16} />}
                label="Dark"
                subtitle="Warm near-black"
              />
              <ThemeCard
                active={mode === "system"}
                onClick={() => setMode("system")}
                icon={<Laptop size={16} />}
                label="System"
                subtitle="Follow OS"
              />
            </div>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-2">
              About
            </h3>
            <div className="rounded-md border border-surface-border bg-surface p-3 text-[12px] text-text-muted space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <img
                    src="/logo.png"
                    alt="Upiqal"
                    className="h-7 w-auto select-none"
                    draggable={false}
                  />
                  <span className="text-text font-medium">Upiqal</span>
                </div>
                <span className="tabular-nums">v0.5.12</span>
              </div>
              <div>
                Cross-platform native FR-IQA viewer built around the UPIQAL
                algorithm.
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-text-faint font-semibold mb-2">
              Links
            </h3>
            <div className="flex flex-col gap-1.5 text-[12px]">
              <InfoLink
                label="GitHub repository"
                href="https://github.com/katolikov/FR-IQA-Algo"
              />
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded border border-surface-border bg-surface text-text-muted">
                <span>License</span>
                <span className="text-[10px] uppercase tracking-wider text-text-faint">
                  in progress
                </span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded border border-surface-border bg-surface text-text-muted">
                <span>Check for Updates</span>
                <span className="text-[10px] uppercase tracking-wider text-text-faint">
                  in progress
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  active,
  onClick,
  icon,
  label,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors",
        active
          ? "border-accent/60 bg-accent/10 text-accent"
          : "border-surface-border text-text-muted hover:border-surface-border-strong hover:bg-surface",
      )}
    >
      <span className="flex items-center gap-2">
        {icon}
        <span className="text-[12px] font-semibold">{label}</span>
      </span>
      <span className="text-[10px] text-text-faint">{subtitle}</span>
    </button>
  );
}

function InfoLink({ label, href }: { label: string; href: string }) {
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      void openExternal(href);
    },
    [href],
  );
  return (
    <a
      href={href}
      onClick={onClick}
      className="flex items-center justify-between px-2.5 py-1.5 rounded border border-surface-border bg-surface hover:bg-surface-hover text-text-muted hover:text-text cursor-pointer"
    >
      <span>{label}</span>
      <ExternalLink size={11} className="text-text-faint" />
    </a>
  );
}

/** Public helper so callers can use the mode as a ThemeMode value. */
export type { ThemeMode };
