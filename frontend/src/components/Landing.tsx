import { useEffect, useRef, useState } from "react";
import { api, type Sample } from "../api";
import { imageFileFrom, openFile, openSample } from "../actions";
import { useApp } from "../store";
import Icon from "./Icons";

const SAMPLE_TEXT: Record<string, [string, string]> = {
  authentic: ["Camera photo", "Untouched. Even noise everywhere, saved once."],
  blended: ["Blended patch", "An oval blended in the way face swaps are."],
  generated: ["Generated image", "Upsampled like GAN and diffusion output."],
};

/** First screen: open a photo or try a sample. */
export default function Landing() {
  const [samples, setSamples] = useState<Sample[]>([]);
  const busy = useApp((s) => s.busy);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]));
  }, []);

  return (
    <div className="landing">
      <div className="drop-card">
        <Icon name="open" size={34} />
        <h1>Drop a photo to inspect it</h1>
        <p className="muted">or paste it, or</p>
        <button className="btn primary big" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Opening…" : "Choose a file"}
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
        <p className="small muted">PNG, JPEG, WebP, BMP, GIF, TIFF</p>
        <p className="small privacy">
          <Icon name="shield" size={14} /> Runs on this computer. Your images are never uploaded anywhere.
        </p>
      </div>

      {samples.length > 0 && (
        <section className="samples">
          <h2>Or try a sample</h2>
          <div className="sample-grid">
            {samples.map((s) => {
              const [title, desc] = SAMPLE_TEXT[s.name] ?? [s.name, ""];
              return (
                <button key={s.name} className="sample" onClick={() => openSample(s.name)} disabled={busy}>
                  <img src={api.sampleThumb(s.name)} alt="" />
                  <strong>{title}</strong>
                  <span className="small muted">{desc}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
