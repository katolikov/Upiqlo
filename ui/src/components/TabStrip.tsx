import { FolderOpen, Images, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessions, type SessionMode } from "@/state/sessions";

export function TabStrip() {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const setActive = useSessions((s) => s.setActive);
  const closeSession = useSessions((s) => s.closeSession);
  const openSession = useSessions((s) => s.openSession);

  return (
    <div className="h-9 bg-surface flex items-stretch border-b border-surface-border shrink-0 overflow-x-auto">
      {sessions.map((sess) => (
        <button
          key={sess.id}
          type="button"
          onClick={() => setActive(sess.id)}
          className={cn(
            "group relative flex items-center gap-2 px-3 text-[12px] border-r border-surface-border shrink-0 max-w-[260px]",
            activeId === sess.id
              ? "bg-surface-raised text-text"
              : "text-text-muted hover:bg-surface-raised/60 hover:text-text",
          )}
        >
          {sess.mode === "single" ? (
            <Images size={13} className="shrink-0 text-text-faint" />
          ) : (
            <FolderOpen size={13} className="shrink-0 text-text-faint" />
          )}
          <span className="truncate">{sess.title}</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              closeSession(sess.id);
            }}
            className="ml-1 p-0.5 rounded hover:bg-surface/80 text-text-faint hover:text-text"
            role="button"
            aria-label="Close tab"
          >
            <X size={12} />
          </span>
          {activeId === sess.id && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
          )}
        </button>
      ))}

      <div className="flex items-center gap-1 px-2">
        <NewTabButton onClick={() => openSession("single")} label="New" icon={<Plus size={12} />} />
        <NewTabButton
          onClick={() => openSession("single")}
          label="Single"
          icon={<Images size={12} />}
          mode="single"
        />
        <NewTabButton
          onClick={() => openSession("folder")}
          label="Folder"
          icon={<FolderOpen size={12} />}
          mode="folder"
        />
      </div>
    </div>
  );
}

function NewTabButton({
  onClick,
  label,
  icon,
  mode,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  mode?: SessionMode;
}) {
  // The first "New" button always opens Single; the explicit Single/Folder
  // buttons are labelled with their mode for discoverability.
  void mode;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text px-2 py-0.5 rounded hover:bg-surface-raised/80"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
