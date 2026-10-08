import { api } from "../api";
import { useApp, useCurrentView, viewsInTab } from "../store";
import { actualSizeAllViewports, fitAllViewports } from "../viewport";
import Icon from "./Icons";
import Pane from "./Pane";
import SidePanel from "./SidePanel";
import Toolbar from "./Toolbar";

/** An analysis tab: view picker, original + view panes, tools and notes. */
export default function Workspace() {
  const config = useApp((s) => s.config)!;
  const image = useApp((s) => s.image)!;
  const tab = useApp((s) => s.tab);
  const paramByView = useApp((s) => s.paramByView);
  const setView = useApp((s) => s.setView);
  const compare = useApp((s) => s.compare);
  const crosshair = useApp((s) => s.crosshair);
  const toggleCompare = useApp((s) => s.toggleCompare);
  const toggleCrosshair = useApp((s) => s.toggleCrosshair);

  const view = useCurrentView();
  if (!view) return null;
  const views = viewsInTab(config, tab);
  const param = view.param ? paramByView[view.id] : undefined;
  const title = view.label + (view.param ? ` · ${view.param.label} ${param}` : "");

  return (
    <div className="workspace">
      <div className="viewbar">
        <div className="segmented" role="tablist" aria-label="Views">
          {views.map((v) => (
            <button key={v.id} role="tab" aria-selected={v.id === view.id} className={v.id === view.id ? "active" : ""} onClick={() => setView(tab, v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className={`btn toggle ${compare ? "on" : ""}`} onClick={toggleCompare} title="Show the original next to the view (S)">
          <Icon name="compare" /> Compare
        </button>
        <button
          className={`btn toggle ${crosshair ? "on" : ""}`}
          onClick={toggleCrosshair}
          title="Point at the same pixel in both images (C)"
        >
          <Icon name="crosshair" /> Crosshair
        </button>
        <span className="divider" />
        <button className="btn icon" onClick={fitAllViewports} title="Fit to window (F, or double-click)">
          <Icon name="fit" />
        </button>
        <button className="btn icon" onClick={actualSizeAllViewports} title="Actual pixels (1 image pixel = 1 screen pixel)">
          <Icon name="actual" />
        </button>
      </div>

      <div className="work-body">
        <Toolbar />
        <div className={`panes ${compare ? "two" : "one"}`}>
          {compare && <Pane url={api.originalUrl(image.id)} space="image" viewId="original" title="Original" editable />}
          <Pane url={api.viewUrl(image.id, view, param)} space={view.space} viewId={view.id} title={title} editable />
        </div>
        <SidePanel view={view} />
      </div>
    </div>
  );
}
