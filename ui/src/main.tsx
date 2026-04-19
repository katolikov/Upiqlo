import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useSessions } from "./state/sessions";
import { usePreferences } from "./state/preferences";
import { useViewport } from "./state/viewport";

// Dev-only escape hatch for driving the app from browser automation /
// e2e tests / manual repro sessions. Stripped from production builds by
// Vite's dead-code elimination when `import.meta.env.DEV` is false.
if (import.meta.env.DEV) {
  (window as unknown as { __UPIQAL__: unknown }).__UPIQAL__ = {
    sessions: useSessions,
    preferences: usePreferences,
    viewport: useViewport,
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
