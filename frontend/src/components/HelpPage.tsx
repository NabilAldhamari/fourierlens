/** Educational reference for non-technical researchers. Static content. */
export default function HelpPage() {
  return (
    <div className="help-page">
      <h1>Understanding the frequency domain</h1>

      <section>
        <h2>What am I looking at?</h2>
        <p>
          The Fourier transform re-describes an image as a sum of sinusoidal gratings — smooth
          striped patterns, each with a frequency (how tightly packed the stripes are), an
          orientation, and a strength. The <b>spectrum panel</b> shows the strength of every such
          grating: the <b>center is DC</b> (the image's average brightness), and moving outward
          means finer and finer detail, up to the <b>Nyquist limit</b> (stripes 2 pixels wide) at
          the edge.
        </p>
        <ul>
          <li><b>Center bright blob</b> — smooth shading and large shapes.</li>
          <li><b>Energy along a direction</b> — edges/stripes <i>perpendicular</i> to that direction in the image.</li>
          <li><b>Isolated bright dots</b> (always in mirrored pairs) — a repeating pattern at exactly one frequency.</li>
          <li><b>Bright axis-aligned cross</b> — usually a windowing artifact: the FFT treats the image as tiling infinitely, and mismatched borders create fake horizontal/vertical edges. Set <i>window</i> to <i>hann</i> to remove it.</li>
        </ul>
      </section>

      <section>
        <h2>The core workflow</h2>
        <ol>
          <li>Load an image (drop, paste, or a sample).</li>
          <li>Spot something interesting in the spectrum — a dot, a ridge, a ring.</li>
          <li>Select it with a shape tool (point ◉, ring ◎, wedge ◔, brush 🖌…).</li>
          <li>Switch <i>pixels show</i> to <b>overlay</b> (or press <b>V</b>): the bright regions in the left panel are exactly where that frequency content lives in the image.</li>
          <li>Switch to <b>filtered</b> to see the image rebuilt <i>without</i> (invert on) or <i>only from</i> (invert off) the selection — drag the divider to compare.</li>
          <li>Pin what you found with the ✎ annotate tool and save the session for colleagues.</li>
        </ol>
      </section>

      <section>
        <h2>Why do spectra of natural photos look alike?</h2>
        <p>
          Natural images obey a <b>1/f² power law</b>: energy falls smoothly with frequency, with
          no isolated peaks. That regularity is what makes deviations diagnostic — the metrics
          panel fits the spectral slope α for every image:
        </p>
        <ul>
          <li><b>α ≈ 2</b> — typical photograph.</li>
          <li><b>α &lt; 1</b> — excess fine detail: heavy sharpening, noise, or synthetic (GAN/diffusion) texture.</li>
          <li><b>α &gt; 3.3</b> — missing fine detail: blur, denoising, or upscaling.</li>
          <li><b>Isolated peaks</b> — periodic interference: moiré, sensor banding, halftone screens.</li>
          <li><b>Peaks at ⅛ multiples</b> — the 8×8 grid of JPEG compression.</li>
        </ul>
        <p>
          The <b>anomalies tab</b> checks all of these automatically and explains each flag in
          plain language. In <b>batch mode</b> the same analysis runs over whole folders, so you
          can rank a dataset by outlier score or anomaly severity before training on it.
        </p>
      </section>

      <section>
        <h2>Keyboard shortcuts</h2>
        <table className="kv-table">
          <tbody>
            <tr><td>1–9</td><td>select tool (pan, point, rect, ellipse, ring, wedge, brush, region-FFT, annotate)</td></tr>
            <tr><td>V</td><td>cycle pixel view: original → overlay → filtered → progressive</td></tr>
            <tr><td>[ / ]</td><td>overlay opacity down / up</td></tr>
            <tr><td>Ctrl+Z</td><td>remove last selection</td></tr>
            <tr><td>Esc</td><td>cancel current drag / dialog</td></tr>
            <tr><td>wheel / middle-drag</td><td>zoom / pan either panel</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Privacy</h2>
        <p>
          FourierLens runs entirely on your machine. Images, spectra, and reports never leave
          <code> 127.0.0.1</code>.
        </p>
      </section>
    </div>
  );
}
