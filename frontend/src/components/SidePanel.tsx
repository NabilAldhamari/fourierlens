import type { Findings, ViewInfo } from "../api";
import { SHAPE_NAMES } from "../annotations";
import { useApp } from "../store";

/** Right-hand panel: what the view shows, its one setting, and the notes list. */
export default function SidePanel({ view }: { view: ViewInfo }) {
  const image = useApp((s) => s.image)!;
  const findings = useApp((s) => s.findings);
  const value = useApp((s) => (view.param ? s.paramByView[view.id] : undefined));
  const setParam = useApp((s) => s.setParam);
  const weakenedByDownscaling = view.tab === "compression" || view.tab === "noise";

  return (
    <aside className="side">
      <section>
        <h2>{view.label}</h2>
        <h3 className="eyebrow">What to look for</h3>
        <p>{view.look_for}</p>

        {view.param && value !== undefined && (
          <label className="slider">
            <span>
              {view.param.label} <output>{value}</output>
            </span>
            <input
              type="range"
              min={view.param.min}
              max={view.param.max}
              step={view.param.step}
              value={value}
              onChange={(e) => setParam(view.id, Number(e.target.value))}
            />
            <span className="small muted">
              {view.id === "ghost"
                ? "Sweep slowly from low to high and watch for one region lighting up."
                : image.meta.jpeg_quality
                  ? `This file was saved at quality ≈ ${image.meta.jpeg_quality}. Try that value too.`
                  : "Try 90 first, then lower values."}
            </span>
          </label>
        )}

        {weakenedByDownscaling && image.meta.downscaled_for_analysis && (
          <p className="callout warn small">This photo was downscaled for analysis, which weakens these traces.</p>
        )}

        {view.tab === "frequency" && findings && <SpectrumChart spectrum={findings.spectrum} />}

        <details>
          <summary>How it works</summary>
          <p className="small">{view.method}</p>
          {view.reference && <p className="small muted">Based on {view.reference}.</p>}
        </details>
      </section>

      <Notes />
    </aside>
  );
}

function Notes() {
  const annotations = useApp((s) => s.annotations);
  const update = useApp((s) => s.updateAnnotation);
  const remove = useApp((s) => s.removeAnnotation);

  return (
    <section className="notes">
      <h2>
        Notes <span className="count">{annotations.length}</span>
      </h2>
      {annotations.length === 0 ? (
        <p className="small muted">
          Pick a tool on the left and draw on either image. Your marks appear here, where you can label them. They are
          included in downloads.
        </p>
      ) : (
        <ul>
          {annotations.map((a, i) => (
            <li key={a.id}>
              <span className="dot" style={{ background: a.color }} />
              <span className="kind">
                {i + 1}. {SHAPE_NAMES[a.kind]}
                {a.space === "spectrum" && <em> · spectrum</em>}
              </span>
              <input
                value={a.text}
                placeholder={a.kind === "text" ? "Note text" : "Add a label"}
                onChange={(e) => update(a.id, { text: e.target.value })}
                aria-label={`Label for mark ${i + 1}`}
              />
              <button className="remove" onClick={() => remove(a.id)} title="Delete this mark" aria-label={`Delete mark ${i + 1}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Radial power spectrum on log-log axes with the fitted 1/f^α line. */
function SpectrumChart({ spectrum }: { spectrum: Findings["spectrum"] }) {
  const { freqs, log_power, fit, alpha } = spectrum;
  if (freqs.length < 4) return null;
  const W = 260;
  const H = 150;
  const pad = { l: 10, r: 8, t: 10, b: 22 };
  const lx = freqs.map((f) => Math.log10(f));
  const ys = [...log_power, ...(fit ?? [])];
  const [x0, x1] = [Math.min(...lx), Math.max(...lx)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - ((y - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${sx(lx[i]).toFixed(1)},${sy(v).toFixed(1)}`).join("");

  return (
    <figure className="chart">
      <figcaption>Power by frequency</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Radial power spectrum">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
        {fit && <path d={line(fit)} className="fit" />}
        <path d={line(log_power)} className="data" />
        <text x={pad.l} y={H - 6} className="tick">coarse</text>
        <text x={W - pad.r} y={H - 6} className="tick" textAnchor="end">fine detail →</text>
      </svg>
      <p className="small muted">
        {alpha !== null && <>Falloff α = {alpha.toFixed(2)} (natural photos: about 2). </>}
        A tail that flattens or bumps up on the right means extra fine-grain energy, as from generators or sharpening.
        A tail that drops steeply means upscaling or blur.
      </p>
    </figure>
  );
}
