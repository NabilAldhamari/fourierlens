import { useState } from "react";
import { useExplore } from "../store";
import type { AnomalyFlag, Metrics } from "../types";
import { OrientationChart, RadialProfileChart } from "./Charts";
import { UI_ICONS } from "./Icons";

const SCALAR_LABELS: Record<string, string> = {
  spectral_slope: "Spectral slope α",
  slope_r2: "Slope fit R²",
  hf_energy_ratio: "High-freq energy",
  mf_energy_ratio: "Mid-freq energy",
  spectral_centroid: "Spectral centroid",
  spectral_bandwidth: "Spectral bandwidth",
  spectral_entropy: "Spectral entropy",
  spectral_flatness: "Spectral flatness",
  dominant_orientation_deg: "Dominant orientation",
  orientation_anisotropy: "Anisotropy",
  blur_score: "Blur score (VoL)",
  mean_intensity: "Mean intensity",
  std_intensity: "Std intensity",
  rms_contrast: "RMS contrast",
};

export function MetricsTab({ metrics }: { metrics: Metrics | null }) {
  if (!metrics) return <p className="muted">Load an image to compute metrics.</p>;
  const slope = metrics.spectral_slope as number;
  return (
    <div className="metrics-tab">
      <RadialProfileChart
        freqs={metrics.radial_profile.freqs}
        power={metrics.radial_profile.power}
        slope={slope}
      />
      <OrientationChart
        histogram={metrics.orientation_histogram}
        dominant={metrics.dominant_orientation_deg as number}
      />
      <table className="kv-table">
        <tbody>
          {Object.entries(SCALAR_LABELS).map(([key, label]) =>
            key in metrics ? (
              <tr key={key}>
                <td>{label}</td>
                <td>{String(metrics[key])}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
      <p className="muted small">
        Natural photographs have α ≈ 2 (power halves 4× per octave). Computed on the {" "}
        Hann-windowed, mean-subtracted luma channel.
      </p>
    </div>
  );
}

export function AnomaliesTab({ flags, onLocate }: { flags: AnomalyFlag[]; onLocate: (f: AnomalyFlag) => void }) {
  if (!flags.length) return <p className="muted">No spectral anomalies flagged for this image. ✓</p>;
  return (
    <div className="anomaly-list">
      {flags.map((f, i) => (
        <details key={i} className="anomaly" open={i === 0}>
          <summary>
            <span className={`sev sev-${f.severity > 0.66 ? "hi" : f.severity > 0.33 ? "mid" : "lo"}`}>
              {(f.severity * 100).toFixed(0)}%
            </span>
            {f.title}
          </summary>
          <p>{f.explanation}</p>
          {f.locations.length > 0 && (
            <button className="btn small locate-btn" onClick={() => onLocate(f)}>
              {UI_ICONS.locate} Highlight peaks &amp; show in image
            </button>
          )}
        </details>
      ))}
    </div>
  );
}

const ANNOTATION_COLORS = ["#f472b6", "#fb923c", "#facc15", "#4ade80", "#7dd3fc", "#c084fc"];

export function AnnotationsTab() {
  const { annotations, updateAnnotation, removeAnnotation } = useExplore();
  const [editing, setEditing] = useState<string | null>(null);

  if (!annotations.length) {
    return (
      <p className="muted">
        No annotations yet. Pick the <b>✎ Annotate</b> tool and drag on the spectrum or the image
        to pin a comment to a region (click once for a single pixel/frequency).
      </p>
    );
  }
  return (
    <div className="annotation-list">
      {annotations.map((a) => (
        <div key={a.id} className="annotation-item" style={{ borderLeftColor: a.color }}>
          <div className="annotation-head">
            <button
              className="eye"
              title={a.visible ? "hide" : "show"}
              onClick={() => updateAnnotation(a.id, { visible: !a.visible })}
            >
              {a.visible ? "👁" : "–"}
            </button>
            {editing === a.id ? (
              <input
                autoFocus
                defaultValue={a.name}
                onBlur={(e) => {
                  updateAnnotation(a.id, { name: e.target.value });
                  setEditing(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <b onDoubleClick={() => setEditing(a.id)} title="double-click to rename">{a.name}</b>
            )}
            <span className="domain-chip">{a.domain}</span>
            <button className="eye danger" title="delete" onClick={() => removeAnnotation(a.id)}>✕</button>
          </div>
          <textarea
            placeholder="comment…"
            defaultValue={a.comment}
            onBlur={(e) => updateAnnotation(a.id, { comment: e.target.value })}
          />
          <div className="color-row">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${a.color === c ? "active" : ""}`}
                style={{ background: c }}
                onClick={() => updateAnnotation(a.id, { color: c })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SelectionsTab() {
  const { selections, removeSelection, invert } = useExplore();
  if (!selections.length) return <p className="muted">No frequency selections. Use the shape tools on the spectrum panel.</p>;
  return (
    <div className="selection-list">
      {invert && <p className="muted small">⚠ inverted: everything EXCEPT these regions is selected.</p>}
      {selections.map((spec, i) => (
        <div key={i} className="selection-item">
          <code>
            {spec.type}
            {spec.type === "annulus" && ` r ${spec.r_inner.toFixed(2)}–${spec.r_outer.toFixed(2)}`}
            {spec.type === "wedge" && ` ${spec.angle_deg.toFixed(0)}° ± ${(spec.width_deg / 2).toFixed(0)}°`}
            {spec.type === "point" && ` (${spec.x.toFixed(2)}, ${spec.y.toFixed(2)})`}
          </code>
          <button className="eye danger" onClick={() => removeSelection(i)}>✕</button>
        </div>
      ))}
    </div>
  );
}
