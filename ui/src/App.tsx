import { useEffect } from "react";
import { FolderOpen, Images } from "lucide-react";
import { TopBar } from "./components/TopBar";
import { TabStrip } from "./components/TabStrip";
import { SingleCompareMode } from "./modes/SingleCompare";
import { FolderCompareMode } from "./modes/FolderCompare";
import { useSessions } from "./state/sessions";

export default function App() {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const openSession = useSessions((s) => s.openSession);

  // Open a Single-compare session on first mount so the user has something
  // to see immediately, matching the "new tab" browser-shell metaphor.
  useEffect(() => {
    if (sessions.length === 0) openSession("single");
  }, [sessions.length, openSession]);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="h-full flex flex-col bg-surface text-text">
      <TopBar />
      <TabStrip />
      {active ? (
        active.mode === "single" ? (
          <SingleCompareMode session={active} />
        ) : (
          <FolderCompareMode session={active} />
        )
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
  const openSession = useSessions((s) => s.openSession);
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md text-center space-y-4">
        <h2 className="text-lg font-medium">No comparison open</h2>
        <p className="text-sm text-text-muted">
          Start a new comparison session to pick two images (Single mode) or two
          folders of images (Folder mode).
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => openSession("single")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-surface-border hover:bg-surface-raised text-sm"
          >
            <Images size={14} /> New Single
          </button>
          <button
            type="button"
            onClick={() => openSession("folder")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-surface-border hover:bg-surface-raised text-sm"
          >
            <FolderOpen size={14} /> New Folder
          </button>
        </div>
      </div>
    </div>
  );
}
