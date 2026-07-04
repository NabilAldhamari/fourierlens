# FourierLens

**Interactive Fourier analysis for computer vision research.** Explore any image in the frequency domain, see exactly *where* each frequency lives in pixel space, annotate and share findings, flag spectral anomalies automatically, and batch-audit entire datasets with exportable metrics.

Everything runs **locally** — no image ever leaves your machine.

## Quickstart

With [uv](https://docs.astral.sh/uv/) (recommended — installs nothing globally):

```
git clone <this-repo>
cd fourierlens
uv run fourierlens
```

Or with plain Python (3.10+):

```
pip install -e .
fourierlens
```

Or just double-click `start.bat` (Windows) / run `./start.sh` (macOS/Linux).

Your browser opens at `http://127.0.0.1:8321` with a sample gallery ready to explore — no configuration, no accounts, no GPU required.

## What it does

### Single-image explorer
- Magnitude / phase / power spectra with DC centered, log/linear/gamma scaling, percentile clipping, colormaps, and window functions (Hann, Hamming, Blackman, Tukey) with plain-language explanations.
- **Frequency → pixel:** select any spectrum region (point + conjugate, rectangle, ellipse, ring, orientation wedge, freehand brush) and see the band's energy overlaid on the image with adjustable opacity — exactly where that frequency content lives.
- **Pixel → frequency:** select an image region to see its localized spectrum.
- Filtering playground: low/high/band-pass, notch, directional and hand-drawn masks with live inverse-FFT reconstruction and before/after comparison.
- Hover readout: cycles/px, wavelength, orientation, plus a live preview of the sinusoidal grating each spectrum point represents.
- Progressive reconstruction: rebuild the image frequency-by-frequency.

### Annotations & sessions
- Pin multiple named, colored highlights with comments to spectrum regions, image regions, or single pixels.
- Save/load sessions as JSON; export annotated views as PNG.

### Anomaly flagging
Automatic detectors with human-readable explanations:
- Isolated spectral peaks → periodic noise, moiré, sensor interference.
- Energy at multiples of ⅛ sampling rate → JPEG block-compression fingerprint.
- Spectral slope deviations from the natural-image 1/f² law → over-sharpening, synthetic (GAN/diffusion) content, or upscaling/blur.

### Batch mode
- Analyze whole folders in parallel; per-image records include resolution, aspect ratio, hashes, and a configurable set of spectral metrics (radial power profile, spectral slope α, high-frequency energy ratio, entropy, orientation statistics, blur score, anomaly flags…).
- Dataset-level mean spectrum and per-image spectral outlier ranking.
- Export CSV / JSON / Parquet. Headless CLI for pipelines:

```
fourierlens batch ./my_dataset --recursive --export report.parquet
fourierlens analyze photo.png --json
```

## Supported formats

PNG, JPEG, WebP, BMP, GIF, and 8/16/32-bit TIFF (grayscale or RGB).

## Development

Backend: Python (NumPy/SciPy/FastAPI) in `src/fourierlens`; tests with `pytest`.
Frontend: React + TypeScript + Vite in `frontend/`; the production build is committed to `src/fourierlens/webui` so end users never need Node.

```
pip install -e ".[dev]"
pytest
cd frontend && npm install && npm run dev   # dev server proxies /api to :8321
npm run build                               # refresh the committed webui bundle
```

## License

MIT
