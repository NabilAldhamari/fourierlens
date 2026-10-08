import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { imageFileFrom, openFile } from "../actions";
import { downloadSideBySide, downloadSingle, type Layer } from "../exportImage";
import { useApp } from "../store";
import Icon from "./Icons";

export const SHORTCUTS: [string, string][] = [
  ["1 – 6", "Switch tab"],
  ["[  ]", "Previous / next view in the tab"],
  ["S", "Show or hide the original"],
  ["C", "Crosshair"],
  ["F", "Fit to window"],
  ["V R E A P T", "Move, rectangle, ellipse, arrow, pen, note"],
  ["Space + drag", "Pan while drawing"],
  ["Ctrl/⌘ + Z", "Undo"],
];

function useCurrentView() {
  const config = useApp((s) => s.config);
  const tab = useApp((s) => s.tab);
  const viewByTab = useApp((s) => s.viewByTab);
  return config?.views.find((v) => v.id === viewByTab[tab]) ?? null;
}

export default function TopBar() {
  const config = useApp((s) => s.config);
  const image = useApp((s) => s.image);
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const findings = useApp((s) => s.findings);
  const busy = useApp((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<"download" | "help" | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const flagCount = findings?.flags.filter((f) => f.severity >= 0.4).length ?? 0;

  return (
    <header className="topbar">
      <span className="logo">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="3" fill="#7dd3fc" />
          <circle cx="16" cy="16" r="8" fill="none" stroke="#7dd3fc" strokeWidth="1.5" opacity="0.6" />
          <circle cx="16" cy="16" r="12.5" fill="none" stroke="#7dd3fc" strokeWidth="1" opacity="0.3" />
        </svg>
        FourierLens
      </span>

      {image && config && (
        <nav className="tabs" aria-label="Analysis">
          {[{ id: "overview", label: "Overview" }, ...config.tabs].map((t, i) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)} title={`${t.label} (${i + 1})`}>
              {t.label}
              {t.id === "overview" && flagCount > 0 && <span className="badge">{flagCount}</span>}
            </button>
          ))}
        </nav>
      )}

      <span className="spacer" />

      {image && (
        <span className="file-name" title={image.meta.filename}>
          {image.meta.filename}
        </span>
      )}
      <button className="btn" onClick={() => input.current?.click()} disabled={busy} title="Open another image">
        <Icon name="open" /> Open
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,.tif,.tiff"
        hidden
        onChange={(e) => {
          const f = imageFileFrom(e.target.files);
          if (f) openFile(f);
          e.target.value = "";
        }}
      />
      {image && (
        <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn primary" onClick={() => setMenu(menu === "download" ? null : "download")}>
            <Icon name="download" /> Download <Icon name="chevron" size={14} />
          </button>
          {menu === "download" && <DownloadMenu onDone={() => setMenu(null)} />}
        </div>
      )}
      <div className="menu-wrap" onPointerDown={(e) => e.stopPropagation()}>
        <button className="btn icon" onClick={() => setMenu(menu === "help" ? null : "help")} title="Keyboard shortcuts">
          <Icon name="help" />
        </button>
        {menu === "help" && (
          <div className="menu shortcuts">
            <h3>Keyboard shortcuts</h3>
            <dl>
              {SHORTCUTS.map(([k, d]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </header>
  );
}

function DownloadMenu({ onDone }: { onDone: () => void }) {
  const image = useApp((s) => s.image)!;
  const config = useApp((s) => s.config)!;
  const annotations = useApp((s) => s.annotations);
  const paramByView = useApp((s) => s.paramByView);
  const setError = useApp((s) => s.setError);
  const view = useCurrentView();

  const stem = image.meta.filename.replace(/\.[^.]+$/, "");
  const original: Layer = { url: api.originalUrl(image.id), space: "image", title: "Original" };
  const param = view?.param ? paramByView[view.id] : undefined;
  const viewTitle = view ? view.label + (view.param ? ` (${view.param.label} ${param})` : "") : "";
  const current: Layer | null = view ? { url: api.viewUrl(image.id, view, param), space: view.space, title: viewTitle } : null;
  const tag = view ? view.id + (param !== undefined ? `_q${param}` : "") : "";
  const n = annotations.length;
  const notes = n ? ` with ${n} note${n > 1 ? "s" : ""}` : "";

  const run = (job: () => Promise<void>) => {
    onDone();
    job().catch((e) => setError(`Download failed: ${(e as Error).message}`));
  };

  return (
    <div className="menu">
      <button
        disabled={!current}
        onClick={() =>
          run(() =>
            downloadSideBySide(original, current!, annotations, `${image.meta.filename} · ${viewTitle} · FourierLens ${config.version}`, `${stem}_${tag}_compare.png`),
          )
        }
      >
        <strong>Side by side</strong>
        <span>{current ? `Original and ${view!.label}${notes}` : "Open an analysis tab first"}</span>
      </button>
      <button disabled={!current} onClick={() => run(() => downloadSingle(current!, annotations, `${stem}_${tag}.png`))}>
        <strong>Current view</strong>
        <span>{current ? `${view!.label}${notes}` : "Open an analysis tab first"}</span>
      </button>
      <button onClick={() => run(() => downloadSingle(original, annotations, `${stem}_original_annotated.png`))}>
        <strong>Original</strong>
        <span>The photo{notes}</span>
      </button>
    </div>
  );
}
