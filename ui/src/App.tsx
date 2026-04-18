import { TopBar } from "./components/TopBar";
import { TabStrip } from "./components/TabStrip";
import { StartScreen } from "./components/StartScreen";
import { SingleCompareMode } from "./modes/SingleCompare";
import { FolderCompareMode } from "./modes/FolderCompare";
import { useSessions } from "./state/sessions";

export default function App() {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="h-full flex flex-col bg-surface text-text">
      <TopBar />
      {sessions.length > 0 && <TabStrip />}
      {active ? (
        active.mode === "single" ? (
          <SingleCompareMode session={active} />
        ) : (
          <FolderCompareMode session={active} />
        )
      ) : (
        <StartScreen />
      )}
    </div>
  );
}
