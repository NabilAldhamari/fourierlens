# FourierLens

[![CI](https://github.com/NabilAldhamari/fourierlens/actions/workflows/ci.yml/badge.svg)](https://github.com/NabilAldhamari/fourierlens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue.svg)](https://www.python.org/downloads/)

Local pixel-level forensics for spotting deepfakes and edited photos. Images never leave your machine.

![FourierLens: a JPEG ghost view next to the original, with notes marking a blended patch](docs/screenshot.png)

## Run

```bash
git clone https://github.com/NabilAldhamari/fourierlens
cd fourierlens
uv run fourierlens        # or: pip install -e . && fourierlens
```

Or with Docker:

```bash
docker compose up
# or: docker run --rm -p 127.0.0.1:8321:8321 ghcr.io/nabilaldhamari/fourierlens:latest
```

Open `http://127.0.0.1:8321`. Keep the port bound to `127.0.0.1`: the app has no login.

## Features

| Tab | Views | Reveals |
|---|---|---|
| Color | Brightness, RGB, chroma, equalized | Lighting and color mismatches |
| Noise | Noise residual, noise level | Regions with inconsistent camera noise |
| Compression | ELA, JPEG ghost | Regions saved at a different JPEG quality |
| Blending | Blending boundary, sharpness | Blend seams, low-resolution patches |
| Frequency | Fourier, DCT, noise spectrum | GAN/diffusion upsampling artifacts |

- Side-by-side view with synced zoom, pan and crosshair.
- Annotate and export PNGs with your notes.
- Automatic checks flag leads (not verdicts) and jump to the relevant view.

These are inspection aids. None proves an image is real or fake.

Formats: PNG, JPEG, WebP, BMP, GIF, TIFF (8/16/32-bit).

## CLI

```bash
fourierlens analyze photo.jpg --json
fourierlens batch ./dataset --recursive --export report.csv
```

## Development

```bash
pip install -e ".[dev]"
pytest
ruff check src tests

fourierlens serve --dev --no-browser          # API on :8321
cd frontend && npm install && npm run dev     # UI on :5173
npm run build                                 # refresh committed bundle in src/fourierlens/webui
```

Release: bump `__version__` in `src/fourierlens/__init__.py` and `frontend/package.json`, update the changelog, then push a `vX.Y.Z` tag.

## License

MIT
