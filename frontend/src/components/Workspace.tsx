import { api } from "../api";
import { useApp } from "../store";
import { viewports } from "../viewport";
import Icon from "./Icons";
import Pane from "./Pane";
import SidePanel from "./SidePanel";
import Toolbar from "./Toolbar";

/** An analysis tab: view picker, original + view panes, tools and notes. */
export default function Workspace() {
  const config = useApp((s) => s.config)!;
  const image = useApp((s) => s.image)!;
  const tab = useApp((s) => s.tab);
  const viewByTab = useApp((s) => s.viewByTab);
  const paramByView = useApp((s) => s.paramByView);
  const setView = useApp((s) => s.setView);
  const compare = useApp((s) => s.compare);
  const crosshair = useApp((s) => s.crosshair);
  const toggleCompare = useApp((s) => s.toggleCompare);
  const toggleCrosshair = useApp((s) => s.toggleCrosshair);

  const views = config.views.filter((v) => v.tab === tab);
  const view = views.find((v) => v.id === viewByTab[tab]) ?? views[0];
  if (!view) return null;
  const param = view.param ? paramByView[view.id] : undefined;
  const title = view.label + (view.param ? ` · ${view.param.label} ${param}` : "");

  const fit = () => {
    viewports.image.reset();
    viewports.spectrum.reset();
  };
  const actual = () => {
    viewports.image.actualSize();
    viewports.spectrum.actualSize();
  };

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
        <button className="btn icon" onClick={fit} title="Fit to window (F, or double-click)">
          <Icon name="fit" />
        </button>
        <button className="btn icon" onClick={actual} title="Actual pixels (1 image pixel = 1 screen pixel)">
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
