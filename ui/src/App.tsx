import { TopBar } from "./components/TopBar";
import { TabStrip } from "./components/TabStrip";
import { StartScreen } from "./components/StartScreen";
import { Toasts } from "./components/Toasts";
import { SingleCompareMode } from "./modes/SingleCompare";
import { FolderCompareMode } from "./modes/FolderCompare";
import { useSessions } from "./state/sessions";
import { useApplyTheme } from "./state/theme";

export default function App() {
  useApplyTheme();
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
      <Toasts />
    </div>
  );
}
