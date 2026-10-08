import { api, type Flag, type ImageMeta } from "../api";
import { useApp } from "../store";
import { SEVERITY_LABELS, severityLevel } from "../severity";
import { viewports } from "../viewport";
import Pane from "./Pane";

function bytes(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

/** First tab after opening: the photo, the automatic checks and the file facts. */
export default function Overview() {
  const image = useApp((s) => s.image)!;
  const findings = useApp((s) => s.findings);

  return (
    <div className="overview">
      <div className="overview-image">
        <Pane url={api.originalUrl(image.id)} space="image" viewId="original" title="Original" editable={false} />
      </div>
      <aside className="overview-side">
        <section>
          <h2>Automatic checks</h2>
          {!findings && <p className="muted"><span className="spinner" /> Checking the image…</p>}
          {findings && findings.flags.length === 0 && (
            <p className="callout">
              Nothing stood out. Automatic checks miss many manipulations, so look through the tabs above before you
              draw a conclusion.
            </p>
          )}
          {findings && findings.flags.map((f, i) => <FlagCard key={i} flag={f} />)}
          {findings && findings.flags.length > 0 && (
            <p className="small muted">These are leads to inspect, not proof. Real photos can trigger them, and many fakes trigger none.</p>
          )}
        </section>

        <section>
          <h2>File</h2>
          <Facts meta={image.meta} />
        </section>

        <section className="guide">
          <h2>How to inspect</h2>
          <ol>
            <li>Open each tab above. Every view says what to look for.</li>
            <li>Turn on <b>Crosshair</b> to point at the same spot in the original and the view.</li>
            <li>Mark what you find with the tools on the left, then use <b>Download</b>.</li>
          </ol>
        </section>
      </aside>
    </div>
  );
}

function FlagCard({ flag }: { flag: Flag }) {
  const config = useApp((s) => s.config);
  const setView = useApp((s) => s.setView);
  const view = config?.views.find((v) => v.id === flag.view);
  const level = severityLevel(flag.severity);

  const show = () => {
    if (!view) return;
    setView(view.tab, view.id);
    if (flag.region && view.space === "image") viewports.image.focus(flag.region);
  };

  return (
    <article className={`flag ${level}`}>
      <header>
        <span className={`chip ${level}`}>{SEVERITY_LABELS[level]}</span>
        <h3>{flag.title}</h3>
      </header>
      <p>{flag.explanation}</p>
      {view && (
        <button className="btn small" onClick={show}>
          Show in {view.label}
          {flag.region ? " and zoom to it" : ""} →
        </button>
      )}
    </article>
  );
}

function Facts({ meta }: { meta: ImageMeta }) {
  // models often repeat the make ("Canon" + "Canon EOS R5")
  const make = meta.camera_make ?? "";
  const model = meta.camera_model ?? "";
  const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim();
  const rows: [string, string][] = [
    ["Format", meta.format + (meta.jpeg_quality ? `, quality ≈ ${meta.jpeg_quality}` : "")],
    ["Size", `${meta.width} × ${meta.height} px, ${bytes(meta.file_size_bytes)}`],
    ["Camera", camera || "Not recorded"],
  ];
  if (meta.software) rows.push(["Software", meta.software]);
  if (meta.date_time) rows.push(["Taken", meta.date_time]);
  rows.push([
    "Metadata",
    meta.has_exif ? "EXIF present" : "No EXIF. Common after sharing online, and for generated images.",
  ]);
  if (meta.generator_metadata?.length) rows.push(["Generator fields", meta.generator_metadata.join(", ")]);
  rows.push(["SHA-256", meta.sha256]);

  return (
    <>
      {meta.downscaled_for_analysis && (
        <p className="callout warn">
          This photo is larger than 4096 px, so it was downscaled to {meta.analysis_width} × {meta.analysis_height} for
          analysis. Downscaling weakens noise and compression traces.
        </p>
      )}
      <dl className="facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
