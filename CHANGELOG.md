# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Changed
- Redesigned the app around deepfake and manipulation forensics. After you open an image, **Overview** shows automatic checks and file facts, and five tabs (Color, Noise, Compression, Blending, Frequency) each hold a few related views with a short "what to look for" note and at most one setting.
- The original and the selected view sit side by side with synced zoom and pan and an optional crosshair. The status bar reads out pixel RGB or spectrum frequency.
- Annotation tools (rectangle, ellipse, arrow, freehand, note) with color, undo and labels; downloads of the side-by-side, the current view or the original, with notes.
- Spectral flag texts are rewritten for the new views.

### Added
- Forensic views: error level analysis, JPEG ghosts, noise residual, local noise level, blending boundary, sharpness, YCbCr chroma, equalized brightness, DCT spectrum, noise-residual spectrum.
- "Missing camera noise" check that locates regions far cleaner than the photo's own noise floor.
- File facts: estimated JPEG quality, camera make and model, software, capture date, and AI generator metadata (for example Stable Diffusion `parameters`).
- New sample gallery: an authentic photo, a blended patch and a generated (upsampled) image.

### Removed
- The Fourier explorer's filtering playground, band-energy overlays, progressive reconstruction, window and colormap options, pre-filters, the Batch page, the two-image Compare page, and the server-side folder browser. The headless `fourierlens batch` and `fourierlens analyze` commands remain.

## [1.2.0] - 2026-10-02

### Added
- Optional pre-filters before analysis: grayscale/luma, histogram equalize, sharpen, blur, Sobel edges, Laplacian, median denoise, invert.
- Docker image and `docker-compose.yml`; the image runs as a non-root user and has a health check.
- Tag-triggered release workflow: builds the sdist and wheel, smoke-tests the wheel, creates a GitHub Release, and publishes a Docker image to GHCR. PyPI publishing is available once enabled (see the workflow header).
- Wheel smoke test (`scripts/smoke_wheel.py`) and a Docker build check in CI.
- Ruff lint in CI; macOS and Python 3.13 added to the test matrix.

### Security
- The server only answers requests addressed to `localhost`, `127.0.0.1` or `[::1]` (extend with `FOURIERLENS_ALLOWED_HOSTS`), blocking DNS-rebinding attacks from web pages.
- Docker Compose and the documented `docker run` now publish the port on `127.0.0.1` only. Previously it was reachable from the whole network, exposing the folder browser and file loading endpoints.
- Image uploads are limited to 256 MB and 256 megapixels (HTTP 413 / 422); oversized images are rejected from the header before decoding.
- Sample names are validated, so wildcard or path characters can no longer reach `glob()`.

### Fixed
- Finished batch jobs are evicted (latest 8 kept) instead of accumulating in memory.
- Project URLs and the README CI badge pointed to the wrong repository.

### Changed
- The package version is defined once in `src/fourierlens/__init__.py`.

## [1.1.0] and earlier

### Added
- Web app: synced pixel/spectrum explorer, frequency-to-pixel and pixel-to-frequency linking, filtering playground, progressive reconstruction.
- Annotations with JSON sessions and PNG export.
- Anomaly flagging: periodic noise, JPEG block fingerprint, spectral slope deviations.
- Batch mode with CSV / JSON / Parquet export, dataset mean spectrum and outlier ranking; `fourierlens batch` and `fourierlens analyze` CLI.
- Compare mode: spectral difference of two images.
