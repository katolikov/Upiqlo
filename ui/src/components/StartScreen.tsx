import { FileImage, FolderOpen, Images, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessions, type RecentEntry } from "@/state/sessions";
import {
  downloadUpiqloFile,
  exportSession,
  importSession,
  pickUpiqloFile,
} from "@/lib/session-io";

/**
 * Full-window home screen shown when no sessions are open.
 * Left: create new (Single / Folder + Import).
 * Right: recents list (click to restore).
 */
export function StartScreen() {
  const openSession = useSessions((s) => s.openSession);
  const openFromRecent = useSessions((s) => s.openFromRecent);
  const hydrateSession = useSessions((s) => s.hydrateSession);
  const recents = useSessions((s) => s.recents);
  const removeRecent = useSessions((s) => s.removeRecent);
  const clearRecents = useSessions((s) => s.clearRecents);

  const onImport = async () => {
    const doc = await pickUpiqloFile();
    if (doc) {
      try {
        const sess = importSession(doc);
        hydrateSession(sess);
      } catch (e) {
        alert(`Import failed: ${(e as Error).message}`);
      }
    }
  };

  const onExportCurrent = () => {
    const active = useSessions.getState().getActive();
    if (!active) return;
    downloadUpiqloFile(exportSession(active), active.title.replace(/\s+/g, "_"));
  };

  return (
    <div className="flex-1 min-h-0 flex items-stretch bg-surface">
      <section className="w-1/2 border-r border-surface-border flex flex-col items-center justify-center p-12 gap-8">
        <div className="text-center">
          <img
            src="/logo.png"
            alt="Upiqlo"
            className="mx-auto h-20 w-auto select-none"
            draggable={false}
          />
          <h2 className="mt-4 text-xl font-semibold text-text">Create new session</h2>
          <p className="mt-1 text-sm text-text-muted max-w-sm">
            Pick two images (or two folders) to compare. Each session is
            isolated — parameters, annotations and results stay per-tab.
          </p>
        </div>

        <div className="w-full max-w-md flex flex-col gap-3">
          <button
            type="button"
            onClick={() => openSession("single")}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-surface-border-strong bg-surface-raised hover:bg-surface-hover text-text text-left"
          >
            <Images size={20} className="text-accent shrink-0" />
            <div>
              <div className="text-sm font-medium">Compare Files</div>
              <div className="text-[11px] text-text-muted">
                Reference image vs target image (A / B)
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => openSession("folder")}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-surface-border-strong bg-surface-raised hover:bg-surface-hover text-text text-left"
          >
            <FolderOpen size={20} className="text-accent shrink-0" />
            <div>
              <div className="text-sm font-medium">Compare Folders</div>
              <div className="text-[11px] text-text-muted">
                Two folders, paired by filename; navigate with Prev / Next
              </div>
            </div>
          </button>

          <div className="h-px bg-surface-border my-1" />

          <button
            type="button"
            onClick={onImport}
            className="flex items-center gap-3 px-4 py-3 rounded-lg border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised/60 text-left"
          >
            <Upload size={18} className="shrink-0" />
            <div>
              <div className="text-sm font-medium">Open Session (.upiqlo)</div>
              <div className="text-[11px] text-text-faint">
                Restore a shared session including params & annotations
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={onExportCurrent}
            className="hidden"
            aria-hidden="true"
          />
        </div>
      </section>

      <section className="w-1/2 flex flex-col p-12 gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-text">Recent sessions</h2>
            <p className="text-sm text-text-muted">
              Click to restore a comparison. Paths are stored locally, not uploaded anywhere.
            </p>
          </div>
          {recents.length > 0 && (
            <button
              type="button"
              onClick={clearRecents}
              className="text-[11px] px-2 py-1 rounded border border-surface-border text-text-muted hover:text-text hover:bg-surface-raised flex items-center gap-1"
              title="Clear recents"
            >
              <Trash2 size={11} /> Clear all
            </button>
          )}
        </div>

        {recents.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center text-text-faint text-sm">
            No recent sessions yet — open one on the left to get started.
          </div>
        ) : (
          <ul className="flex flex-col gap-2 overflow-y-auto">
            {recents.map((r) => (
              <RecentRow
                key={r.id + r.lastOpenedAt}
                entry={r}
                onOpen={() => openFromRecent(r)}
                onRemove={() => removeRecent(r.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RecentRow({
  entry,
  onOpen,
  onRemove,
}: {
  entry: RecentEntry;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const icon = entry.mode === "single" ? <FileImage size={14} /> : <FolderOpen size={14} />;
  const primary =
    entry.mode === "single"
      ? `${basename(entry.referencePath)} ↔ ${basename(entry.targetPath)}`
      : `${basename(entry.referenceDir)} ↔ ${basename(entry.targetDir)}`;
  return (
    <li>
      <div className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-surface-border hover:border-surface-border-strong bg-surface-raised/60 hover:bg-surface-raised">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
          <span className="text-accent shrink-0">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-text truncate">{entry.title}</span>
            <span className="block text-[11px] text-text-muted truncate">{primary}</span>
          </span>
          {entry.lastScore !== undefined && (
            <span
              className={cn(
                "text-[11px] tabular-nums px-2 py-0.5 rounded-full border border-surface-border",
                scoreColor(entry.lastScore),
              )}
              title={entry.lastDominant ?? undefined}
            >
              {entry.lastScore.toFixed(3)}
            </span>
          )}
          <span className="text-[10px] text-text-faint shrink-0">
            {relativeTime(entry.lastOpenedAt)}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-faint hover:text-text hover:bg-surface"
          title="Remove from recents"
        >
          <X size={12} />
        </button>
      </div>
    </li>
  );
}

function basename(path: string | null | undefined): string {
  if (!path) return "?";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function scoreColor(score: number): string {
  if (score >= 0.9) return "text-signal-success";
  if (score >= 0.75) return "text-signal-success";
  if (score >= 0.6) return "text-signal-warning";
  if (score >= 0.45) return "text-signal-warning";
  return "text-signal-danger";
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}
