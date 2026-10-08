# FourierLens

[![CI](https://github.com/NabilAldhamari/fourierlens/actions/workflows/ci.yml/badge.svg)](https://github.com/NabilAldhamari/fourierlens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/downloads/)
[![compute: NumPy | SciPy](https://img.shields.io/badge/compute-NumPy%20%7C%20SciPy-013243.svg)](https://numpy.org/)
[![UI: React + TS](https://img.shields.io/badge/UI-React%20%2B%20TypeScript-149eca.svg)](https://react.dev/)
[![privacy: 100% local](https://img.shields.io/badge/privacy-100%25%20local-4ade80.svg)](#privacy)

**Pixel-level forensics for spotting deepfakes and edited photos.** Open an image and inspect it the way forensic analysts do: color channels, noise, compression traces, blending seams and frequency spectra, each shown next to the original with a shared crosshair. Mark what you find and download annotated images for your research.

Everything runs **locally**; no image ever leaves your machine.

![FourierLens: a JPEG ghost view next to the original, with notes marking a blended patch](docs/screenshot.png)

## Quickstart

With [uv](https://docs.astral.sh/uv/) (recommended, installs nothing globally):

```bash
git clone https://github.com/NabilAldhamari/fourierlens
cd fourierlens
uv run fourierlens
```

Or install the released package (once published to PyPI):

```bash
pipx install fourierlens   # or: uvx fourierlens
fourierlens
```

Or with plain Python (3.10+):

```bash
pip install -e .
fourierlens
```

Or just double-click `start.bat` (Windows) / run `./start.sh` (macOS/Linux).

Your browser opens at `http://127.0.0.1:8321` with a sample gallery ready to explore. No configuration, no accounts, no GPU required.

## Run with Docker

The container needs no Python or Node on your machine, only Docker.

With Docker Compose (easiest):

```bash
docker compose up
```

Then open `http://127.0.0.1:8321` in your browser. Stop it with `Ctrl+C`, or run detached with `docker compose up -d` and stop with `docker compose down`.

Prebuilt image from GitHub Container Registry:

```bash
docker run --rm -p 127.0.0.1:8321:8321 ghcr.io/nabilaldhamari/fourierlens:latest
```

Always publish the port on `127.0.0.1` as shown: the app has no login, so it must not be reachable from your network.

Plain Docker, without Compose:

```bash
docker build -t fourierlens .
docker run --rm -p 127.0.0.1:8321:8321 fourierlens
```

## What it does

Open a photo (drop, paste or choose a file). FourierLens starts on **Overview**: automatic checks, file facts (JPEG quality, camera, editing software, AI generator metadata) and the photo itself. Five tabs group the forensic views:

| Tab | Views | What they reveal |
|---|---|---|
| **Color** | Brightness, Red, Green, Blue, Chroma blue, Chroma red, Equalized | Lighting direction, skin-tone and color-balance mismatches between a face and its surroundings, detail hidden in shadows |
| **Noise** | Noise residual, Noise level | Pasted or generated regions that are smoother, blotchier or cleaner than the camera noise around them |
| **Compression** | Error level (ELA), JPEG ghost | Regions saved a different number of times or at a different JPEG quality than the rest |
| **Blending** | Blending boundary, Sharpness | The seam where a face or object was blended in, and areas generated at a lower resolution |
| **Frequency** | Fourier spectrum, DCT spectrum, Noise spectrum, power-by-frequency chart | Grids of spectral peaks left by GAN and diffusion upsampling, resizing and JPEG; unnatural spectral falloff |

Every view says in one or two sentences what to look for, with at most one setting (the JPEG quality for ELA and ghosts).

**Compare.** The original sits next to the view. Zoom and pan are synced, and **Crosshair** marks the same pixel in both. The status bar shows the pixel position and RGB value, or the frequency, period and angle on a spectrum.

**Annotate and download.** Draw rectangles, ellipses, arrows and freehand marks, add text notes, and label any mark from the Notes list. **Download** exports the side-by-side comparison, the current view or the original, with your notes, as PNG at full analysis resolution.

**Automatic checks** point you at leads, never at verdicts: a region with almost no camera noise, generator metadata in the file, repeating spectral patterns, an unnatural spectral falloff. Each opens the view that shows it and zooms to the region.

### Techniques

| Technique | Reference |
|---|---|
| Error level analysis | N. Krawetz, *A Picture's Worth*, Black Hat 2007 |
| JPEG ghosts | H. Farid, *Exposing Digital Forgeries from JPEG Ghosts*, IEEE TIFS 2009 |
| Noise residuals | P. Zhou et al., *Learning Rich Features for Image Manipulation Detection*, CVPR 2018 |
| Local noise level | B. Mahdian & S. Saic, *Using noise inconsistencies for blind image forensics*, IVC 2009; J. Immerkær, *Fast Noise Variance Estimation*, CVIU 1996 |
| Blending boundary | Idea from L. Li et al., *Face X-ray for More General Face Forgery Detection*, CVPR 2020 (here computed from local statistics, not a trained network) |
| Resolution inconsistency | Y. Li & S. Lyu, *Exposing DeepFake Videos By Detecting Face Warping Artifacts*, CVPRW 2019 |
| Chroma inconsistency | S. McCloskey & M. Albright, *Detecting GAN-generated Imagery using Color Cues*, 2018 |
| Fourier spectrum artifacts | X. Zhang et al., *Detecting and Simulating Artifacts in GAN Fake Images*, WIFS 2019; R. Durall et al., *Watch your Up-Convolution*, CVPR 2020 |
| DCT spectrum | J. Frank et al., *Leveraging Frequency Analysis for Deep Fake Image Recognition*, ICML 2020 |
| Noise-residual spectrum | R. Corvi et al., *On the detection of synthetic images generated by diffusion models*, ICASSP 2023 |

These are inspection aids. None of them proves an image is fake or real, and modern generators followed by recompression can hide every one of these traces.

### Headless CLI

```bash
fourierlens analyze photo.jpg --json                         # metrics + spectral flags for one image
fourierlens batch ./dataset --recursive --export report.csv  # dataset audit: CSV / JSON / Parquet
```

## Supported formats

PNG, JPEG, WebP, BMP, GIF, and 8/16/32-bit TIFF (grayscale or RGB).

## Privacy

FourierLens runs entirely on your machine. Images, spectra, and reports never leave `127.0.0.1`, which keeps medical, proprietary, or unpublished research data safe.

## Development

Backend: Python (NumPy/SciPy/FastAPI) in `src/fourierlens`; tests with `pytest`.
Frontend: React + TypeScript + Vite in `frontend/`; the production build is committed to `src/fourierlens/webui` so end users never need Node.

```bash
pip install -e ".[dev]"
pytest

# Live-reload dev loop: API on :8321 (auto-reloads on Python edits),
# UI on :5173 (Vite HMR, proxies /api to :8321)
fourierlens serve --dev --no-browser
cd frontend && npm install && npm run dev

# Refresh the committed production bundle after UI changes
npm run build
```

Lint with `ruff check src tests`. CI runs ruff, the pytest matrix (Linux, Windows, macOS; Python 3.10, 3.12, 3.13), a wheel install smoke test, a Docker build, and verifies the committed `webui` bundle is up to date with the frontend sources.

### Releasing

1. Bump `__version__` in `src/fourierlens/__init__.py` (and `version` in `frontend/package.json`), and move the changelog entries under the new version.
2. Merge to `main`, then push a tag: `git tag v1.2.0 && git push origin v1.2.0`.
3. The Release workflow tests, builds, smoke-tests the wheel, creates the GitHub Release and pushes the Docker image to GHCR. To also publish to PyPI, add a trusted publisher for this repository (workflow `release.yml`, environment `pypi`) and set the repository variable `PUBLISH_TO_PYPI` to `true`.

## License

MIT
