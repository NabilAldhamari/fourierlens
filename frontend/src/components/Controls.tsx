import { COLORMAP_NAMES, lutGradient } from "../colormaps";
import { useExplore } from "../store";
import type { Tool } from "../types";
import { TOOL_ICONS } from "./Icons";

/** Every tool documents BOTH behaviors: what it does on the spectrum panel and
 * what it does on the pixel panel. `hint` is shown persistently in the hint
 * bar under the toolbar - not just on hover. Icons are SVG (see Icons.tsx):
 * Unicode symbols render as tofu rectangles on many Windows machines. */
export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  {
    id: "pan",
    label: "Pan",
    hint: "Drag to move, mouse-wheel to zoom. Both panels stay in sync — the spot you look at in the image is the spot you look at in the spectrum. (Middle-drag pans with any tool.)",
  },
  {
    id: "point",
    label: "Point",
    hint: "On the spectrum: click a bright dot to select that exact frequency (its mirror twin is included automatically — real images always have symmetric pairs). On the image: click to open a local spectrum of the area around that pixel.",
  },
  {
    id: "rect",
    label: "Rect",
    hint: "On the spectrum: drag a box to select a frequency region — the left panel immediately shows WHERE that content lives in the image. On the image: drag a box to see the local spectrum of just that region.",
  },
  {
    id: "ellipse",
    label: "Ellipse",
    hint: "On the spectrum: drag an oval around a frequency region. On the image: drag to inspect that region's local spectrum.",
  },
  {
    id: "annulus",
    label: "Ring",
    hint: "On the spectrum: drag from an inner to an outer radius around the center — this is a band-pass: 'keep only details between THIS coarse and THIS fine'. On the image: drag to inspect a region's local spectrum.",
  },
  {
    id: "wedge",
    label: "Wedge",
    hint: "On the spectrum: drag to pick a direction — selects all frequencies at that orientation (stripes/edges perpendicular to it in the image). On the image: drag to inspect a region's local spectrum.",
  },
  {
    id: "brush",
    label: "Brush",
    hint: "On the spectrum: paint freely over any features you want to select (the mirrored copy is painted for you). On the image: drag to inspect a region's local spectrum.",
  },
  {
    id: "roi",
    label: "Region FFT",
    hint: "Drag a rectangle on the IMAGE: a card pops up showing the spectrum of just that region — 'what frequencies does this area contain?'. This is the pixel→frequency direction; the selection tools are the frequency→pixel direction.",
  },
  {
    id: "annotate",
    label: "Annotate",
    hint: "Drag a box (or single-click a point) on EITHER panel to pin a named, colored comment there. Annotations save into sessions so colleagues can load your findings.",
  },
];

export function Toolbar() {
  const { tool, set, clearSelections, selections, invert } = useExplore();
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? "active" : ""}`}
          title={t.hint}
          onClick={() => set({ tool: t.id })}
        >
          <span className="tool-icon">{TOOL_ICONS[t.id]}</span>
          <span className="tool-label">{t.label}</span>
        </button>
      ))}
      <div className="toolbar-sep" />
      <label
        className="check"
        title="Flip the selection: analyze/keep everything EXCEPT the drawn regions. Combine with a point selection and the 'filtered' view to build a notch filter that removes periodic noise."
      >
        <input type="checkbox" checked={invert} onChange={(e) => set({ invert: e.target.checked })} />
        invert
      </label>
      <button
        className="tool-btn danger"
        disabled={selections.length === 0}
        onClick={clearSelections}
        title="Remove all frequency selections"
      >
        ✕ clear ({selections.length})
      </button>
    </div>
  );
}

/** Persistent explanation of the active tool — tooltips only help if you know
 * to hover; this bar teaches without being asked. */
export function ToolHintBar() {
  const tool = useExplore((s) => s.tool);
  const hint = TOOLS.find((t) => t.id === tool)?.hint ?? "";
  return (
    <div className="tool-hint">
      <span className="tool-hint-chip">{TOOLS.find((t) => t.id === tool)?.label}</span>
      {hint}
    </div>
  );
}

function Select<T extends string>({ label, value, options, onChange, title, format }: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  title?: string;
  format?: (v: T) => string;
}) {
  return (
    <label className="ctl" title={title}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>{format ? format(o) : o}</option>
        ))}
      </select>
    </label>
  );
}

function Slider({ label, value, min, max, step, onChange, title, display }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  title?: string;
  display?: string;
}) {
  return (
    <label className="ctl slider" title={title}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      <em>{display ?? value}</em>
    </label>
  );
}

const KIND_HELP: Record<string, string> = {
  magnitude: "How STRONG each frequency is. The view you want 95% of the time.",
  phase: "WHERE each frequency sits in the image (its offset). Looks like noise for most images — that's normal.",
  psd: "Power spectral density (magnitude squared). Same shapes as magnitude, more contrast between strong and weak.",
};

const CHANNEL_HELP =
  "Which channel is analyzed. 'luma' = perceptual brightness (this IS the grayscale conversion). r/g/b analyze one color channel — useful for chroma-specific artifacts like JPEG color subsampling.";

export function PreprocessControls({
  ops,
}: {
  ops: Record<string, { label: string; uses_amount: boolean; description: string }>;
}) {
  const s = useExplore();
  const keys = Object.keys(ops).length ? Object.keys(ops) : ["none"];
  const current = ops[s.preprocess];
  return (
    <div className="controls-row pre-row">
      <span className="row-tag" title="Optional filter applied to the image BEFORE the Fourier transform. Everything downstream (spectrum, overlays, metrics, anomaly flags) analyzes the filtered result.">
        pre-filter
      </span>
      <Select
        label=""
        value={s.preprocess}
        options={keys as readonly string[]}
        onChange={(preprocess) => s.set({ preprocess })}
        format={(k) => ops[k]?.label ?? k}
        title={current?.description ?? "Transform the image before analysis"}
      />
      {current?.uses_amount && (
        <Slider
          label="strength"
          value={s.preAmount}
          min={0.1}
          max={3}
          step={0.1}
          onChange={(preAmount) => s.set({ preAmount })}
          display={s.preAmount.toFixed(1)}
          title="How strongly the pre-filter is applied (1 = its natural default)"
        />
      )}
      {s.preprocess !== "none" && (
        <>
          <span className="hint-inline">{current?.description}</span>
          <button className="tool-btn danger" onClick={() => s.set({ preprocess: "none" })} title="Remove the pre-filter">
            ✕ off
          </button>
        </>
      )}
    </div>
  );
}

export function SpectrumControls({ windowDescriptions }: { windowDescriptions: Record<string, string> }) {
  const s = useExplore();
  return (
    <div className="controls-row">
      <span className="row-tag" title="These options control how the frequency spectrum (right panel) is computed and displayed.">
        spectrum
      </span>
      <Select label="view" value={s.kind} options={["magnitude", "phase", "psd"] as const}
        onChange={(kind) => s.set({ kind })}
        title={KIND_HELP[s.kind]} />
      <Select label="channel" value={s.channel} options={["luma", "r", "g", "b"] as const}
        onChange={(channel) => s.set({ channel })}
        title={CHANNEL_HELP} />
      <Select label="window" value={s.window} options={["none", "hann", "hamming", "blackman", "tukey"] as const}
        onChange={(window) => s.set({ window })}
        title={
          (windowDescriptions[s.window] ?? "") +
          " — Windows fade the image borders before the FFT. Without one, the FFT treats the image as tiling forever, and the border mismatch paints a fake bright cross through the spectrum center."
        } />
      <Select label="scale" value={s.scale} options={["log", "linear", "gamma"] as const}
        onChange={(scale) => s.set({ scale })}
        title="Brightness curve for displaying the spectrum. 'log' compresses the huge range so faint details are visible (recommended). 'linear' shows true proportions (usually just one bright dot at center). 'gamma' is adjustable in between." />
      {s.scale === "gamma" && (
        <Slider label="γ" value={s.gamma} min={0.05} max={1} step={0.05} onChange={(gamma) => s.set({ gamma })}
          title="Lower = brighter faint details" />
      )}
      <Slider label="clip %" value={s.clipHi} min={95} max={100} step={0.1} onChange={(clipHi) => s.set({ clipHi })}
        title="Treats the brightest X percentile as 'maximum brightness'. Lowering it makes faint spectrum structure pop (the very bright center otherwise crushes everything else to black)." display={`${s.clipHi.toFixed(1)}`} />
      <Select label="colors" value={s.spectrumColormap} options={COLORMAP_NAMES as readonly string[]}
        onChange={(spectrumColormap) => s.set({ spectrumColormap })}
        title="Purely cosmetic: how spectrum intensity maps to color. viridis/magma are colorblind-safe." />
      <span className="cmap-strip" style={{ background: lutGradient(s.spectrumColormap) }} />
    </div>
  );
}

export function OverlayControls() {
  const s = useExplore();
  const hasSelection = s.selections.length > 0 || s.invert;
  return (
    <div className="controls-row">
      <span className="row-tag" title="These options control what the LEFT panel displays.">left panel</span>
      <Select label="shows" value={s.pixelView}
        options={["original", "overlay", "filtered", "progressive"] as const}
        onChange={(pixelView) => s.set({ pixelView })}
        format={(v) =>
          ({
            original: "original image",
            overlay: "image + 'where is it?' overlay",
            filtered: "filtered image (before/after)",
            progressive: "progressive rebuild",
          })[v]
        }
        title={
          "original: the untouched image (or pre-filtered, if a pre-filter is on).\n" +
          "overlay: heat-map of where your selected frequencies live in the image.\n" +
          "filtered: the image rebuilt from (or without, if inverted) the selected frequencies, with a before/after divider.\n" +
          "progressive: rebuild the image from coarse to fine using the slider.\n" +
          "Press V to cycle."
        } />
      {s.pixelView === "overlay" && (
        <>
          <Slider label="opacity" value={s.overlayOpacity} min={0} max={1} step={0.02}
            onChange={(overlayOpacity) => s.set({ overlayOpacity })}
            display={`${Math.round(s.overlayOpacity * 100)}%`}
            title="How strongly the heat-map covers the image. Keyboard: [ and ]" />
          <Select label="heat colors" value={s.overlayColormap} options={COLORMAP_NAMES as readonly string[]}
            onChange={(overlayColormap) => s.set({ overlayColormap })}
            title="Colormap for the energy heat-map (dark = none of the selected frequencies there, bright = lots)" />
          <span className="cmap-strip" style={{ background: lutGradient(s.overlayColormap) }} />
        </>
      )}
      {s.pixelView === "filtered" && (
        <Slider label="divider" value={s.compareSlider} min={0} max={1} step={0.01}
          onChange={(compareSlider) => s.set({ compareSlider })}
          display=""
          title="Position of the split line: LEFT of it = filtered result, RIGHT of it = original. Drag fully right to see only the filtered image." />
      )}
      {s.pixelView === "progressive" && (
        <Slider label="detail level" value={s.progressiveFraction} min={0.005} max={1} step={0.005}
          onChange={(progressiveFraction) => s.set({ progressiveFraction })}
          display={`${Math.round(s.progressiveFraction * 100)}%`}
          title="Rebuild the image using only frequencies up to this fraction of the maximum. Slide right to watch detail return coarse-to-fine — the best intuition builder for what 'frequency' means." />
      )}
      {(s.pixelView === "overlay" || s.pixelView === "filtered") && (
        <Slider label="soft edges" value={s.softPx} min={0} max={20} step={1}
          onChange={(softPx) => s.set({ softPx })} display={`${s.softPx}px`}
          title="Softens the boundary of your frequency selection. Hard cuts in the spectrum cause 'ringing' (ripples) in the filtered image; a few pixels of softness removes them." />
      )}
      {!hasSelection && (s.pixelView === "overlay" || s.pixelView === "filtered") && (
        <span className="hint-inline">← nothing selected yet: draw on the spectrum with a shape tool</span>
      )}
      {(s.tool === "point" || s.tool === "brush") && (
        <Slider label={s.tool === "point" ? "point size" : "brush size"} value={s.tool === "point" ? s.pointRadius : s.brushRadius}
          min={0.005} max={0.15} step={0.005}
          onChange={(v) => s.set(s.tool === "point" ? { pointRadius: v } : { brushRadius: v })}
          display={(s.tool === "point" ? s.pointRadius : s.brushRadius).toFixed(3)}
          title="Radius of the point/brush selection, as a fraction of the maximum frequency" />
      )}
      {s.tool === "wedge" && (
        <Slider label="wedge width" value={s.wedgeWidth} min={2} max={60} step={1}
          onChange={(wedgeWidth) => s.set({ wedgeWidth })} display={`${s.wedgeWidth}°`}
          title="Angular width of the orientation wedge in degrees" />
      )}
    </div>
  );
}
