import { useEffect, useState } from "react";
import { api } from "./api";
import BatchPage from "./components/BatchPage";
import ComparePage from "./components/ComparePage";
import ExplorePage from "./components/ExplorePage";
import HelpPage from "./components/HelpPage";
import { useApp, type Tab } from "./store";

const TABS: { id: Tab; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "batch", label: "Batch" },
  { id: "compare", label: "Compare" },
  { id: "help", label: "Help" },
];

export default function App() {
  const { tab, setTab } = useApp();
  const [windowDescriptions, setWindowDescriptions] = useState<Record<string, string>>({});
  const [serverOk, setServerOk] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .config()
      .then((cfg) => {
        setWindowDescriptions(cfg.windows);
        setServerOk(true);
      })
      .catch(() => setServerOk(false));
  }, []);

  return (
    <div className="app">
      <nav className="app-nav">
        <span className="logo" title="FourierLens">
          <svg width="22" height="22" viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="3" fill="#7dd3fc" />
            <circle cx="16" cy="16" r="8" fill="none" stroke="#7dd3fc" strokeWidth="1.5" opacity="0.6" />
            <circle cx="16" cy="16" r="12.5" fill="none" stroke="#7dd3fc" strokeWidth="1" opacity="0.3" />
          </svg>
          FourierLens
        </span>
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <span className="spacer" />
        <span className="muted small">local · nothing leaves your machine</span>
      </nav>
      {serverOk === false && (
        <div className="error-banner">
          ⚠ Cannot reach the FourierLens server. Start it with <code>fourierlens</code> (or <code>uv run fourierlens</code>).
        </div>
      )}
      <main className={tab === "explore" ? "main-explore" : ""}>
        {tab === "explore" && <ExplorePage windowDescriptions={windowDescriptions} />}
        {tab === "batch" && <BatchPage />}
        {tab === "compare" && <ComparePage />}
        {tab === "help" && <HelpPage />}
      </main>
    </div>
  );
}
