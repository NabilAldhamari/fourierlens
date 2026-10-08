import { useEffect, useState } from "react";
import { api } from "./api";
import { imageFileFrom, openFile } from "./actions";
import Icon from "./components/Icons";
import Landing from "./components/Landing";
import Overview from "./components/Overview";
import StatusBar from "./components/StatusBar";
import TopBar from "./components/TopBar";
import Workspace from "./components/Workspace";
import { useApp, viewsInTab, type Tool } from "./store";
import { fitAllViewports } from "./viewport";

const TOOL_KEYS: Record<string, Tool> = { v: "move", r: "rect", e: "ellipse", a: "arrow", p: "pen", t: "text" };

export default function App() {
  const config = useApp((s) => s.config);
  const image = useApp((s) => s.image);
  const tab = useApp((s) => s.tab);
  const error = useApp((s) => s.error);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState(false);

  // retry briefly: at startup the API may still be booting behind the UI
  useEffect(() => {
    let stopped = false;
    let tries = 0;
    const attempt = () =>
      api
        .config()
        .then((cfg) => {
          if (stopped) return;
          useApp.getState().setConfig(cfg);
          setServerOk(true);
        })
        .catch(() => {
          if (stopped) return;
          if (++tries < 10) setTimeout(attempt, 700);
          else setServerOk(false);
        });
    attempt();
    return () => {
      stopped = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      const s = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        s.undo();
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || !s.image || !s.config) return;
      const key = e.key.toLowerCase();
      const tabs = ["overview", ...s.config.tabs.map((x) => x.id)];
      if (/^[1-9]$/.test(key) && Number(key) <= tabs.length) s.setTab(tabs[Number(key) - 1]);
      else if (key in TOOL_KEYS) s.setTool(TOOL_KEYS[key]);
      else if (key === "c") s.toggleCrosshair();
      else if (key === "s") s.toggleCompare();
      else if (key === "f") fitAllViewports();
      else if ((key === "[" || key === "]") && s.tab !== "overview") {
        const views = viewsInTab(s.config, s.tab);
        const i = views.findIndex((v) => v.id === s.viewByTab[s.tab]);
        const next = views[(i + (key === "]" ? 1 : -1) + views.length) % views.length];
        s.setView(s.tab, next.id);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const f = imageFileFrom(e.clipboardData?.files);
      if (f) openFile(f);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = imageFileFrom(e.dataTransfer.files);
        if (f) openFile(f);
      }}
    >
      <TopBar />
      {serverOk === false && (
        <div className="banner error">
          Cannot reach the FourierLens server. Start it with <code>fourierlens</code> (or <code>uv run fourierlens</code>).
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="btn icon" onClick={() => useApp.getState().setError(null)} aria-label="Dismiss">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <main>
        {!image || !config ? <Landing /> : tab === "overview" ? <Overview /> : <Workspace />}
      </main>
      <StatusBar />
      {dragging && (
        <div className="drop-overlay">
          <Icon name="open" size={40} />
          Drop to open
        </div>
      )}
    </div>
  );
}
