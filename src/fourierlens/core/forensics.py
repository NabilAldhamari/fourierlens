"""Pixel-level forensic views for spotting edited, blended and AI-generated images.

Each view turns an RGB image into a picture a person can read: a channel, a
residual, a heat map or a spectrum. Views never decide "fake" on their own; they
make the traces that manipulation leaves behind visible, so a researcher can
compare them against the original.

Techniques (see README for references):

    color        luminance, R/G/B, YCbCr chroma, equalized contrast
    noise        median-filter noise residual; local noise level (Immerkaer)
    compression  error level analysis (Krawetz); JPEG ghosts (Farid)
    blending     blending-boundary map (Face X-ray idea, statistics-based);
                 local sharpness / resolution inconsistency (Li & Lyu)
    frequency    Fourier spectrum (Zhang et al., Durall et al.); DCT spectrum
                 (Frank et al.); noise-residual spectrum (Corvi et al.)

All functions take an HxWx3 uint8 image and return a uint8 display image the
same size (HxW gray or HxWx3 RGB).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO

import numpy as np
from PIL import Image
from scipy import fft as sfft
from scipy.ndimage import (
    convolve,
    gaussian_filter,
    label,
    median_filter,
    sobel,
    uniform_filter,
)
from scipy.ndimage import median as nd_median

from .fft import compute_fft, power_spectrum, radius_grid, to_uint8
from .io import LUMA_WEIGHTS
from .metrics import radial_profile, spectral_slope

# --------------------------------------------------------------------------
# catalog: the single source of truth for tabs, labels and help text

TABS = [
    ("color", "Color"),
    ("noise", "Noise"),
    ("compression", "Compression"),
    ("blending", "Blending"),
    ("frequency", "Frequency"),
]


@dataclass(frozen=True)
class ViewInfo:
    id: str
    tab: str
    label: str
    look_for: str
    method: str
    reference: str = ""
    # "image": same pixel grid as the photo (synced zoom, crosshair).
    # "spectrum": frequency plane (own zoom, frequency readout).
    space: str = "image"
    param: dict | None = field(default=None)


_DEFAULT_ELA_QUALITY = 90
_DEFAULT_GHOST_QUALITY = 75
_QUALITY = {"name": "quality", "label": "JPEG quality", "min": 50, "max": 100, "step": 1}

VIEWS: list[ViewInfo] = [
    ViewInfo(
        "luma", "color", "Brightness",
        "Shading and lighting without color. Check that light falls on a face from the same "
        "direction as on the rest of the scene.",
        "Rec. 709 luminance.",
    ),
    ViewInfo(
        "red", "color", "Red",
        "One color channel. Pasted or generated regions sometimes have a different balance "
        "between the channels than their surroundings.",
        "Red channel as grayscale.",
    ),
    ViewInfo("green", "color", "Green", "One color channel. Compare it with Red and Blue.", "Green channel as grayscale."),
    ViewInfo("blue", "color", "Blue", "One color channel. Camera noise is usually strongest here.", "Blue channel as grayscale."),
    ViewInfo(
        "chroma_cb", "color", "Chroma blue",
        "Color without brightness, contrast-stretched. A face with a slightly different skin tone than "
        "the neck or hands shows up as a patch with a visible edge.",
        "YCbCr Cb (blue-difference) channel, stretched to the 0.5-99.5 percentile range.",
        "McCloskey & Albright, 2018",
    ),
    ViewInfo(
        "chroma_cr", "color", "Chroma red",
        "Color without brightness, contrast-stretched. Skin tones live mostly here, so face swaps "
        "with a color mismatch stand out.",
        "YCbCr Cr (red-difference) channel, stretched to the 0.5-99.5 percentile range.",
        "McCloskey & Albright, 2018",
    ),
    ViewInfo(
        "equalized", "color", "Equalized",
        "Histogram-equalized brightness reveals detail hidden in shadows and highlights, such as "
        "smudges, halos or cloned texture.",
        "Histogram equalization of luminance; chroma kept.",
    ),
    ViewInfo(
        "noise", "noise", "Noise residual",
        "The fine grain left after removing image content. A real photo has even, fine grain "
        "everywhere. A pasted or generated region often looks smoother, blotchier or more "
        "patterned than the rest.",
        "|luminance − 3×3 median filter|, amplified.",
        "Zhou et al., 2018 (RGB-N)",
    ),
    ViewInfo(
        "noise_level", "noise", "Noise level",
        "How noisy each area is compared with the whole photo. Blue = cleaner, red = noisier. "
        "A blue island shaped like a face or object suggests it came from a different source.",
        "Local noise standard deviation (Immerkaer estimator, edges excluded), log ratio to the image median.",
        "Mahdian & Saic, 2009",
    ),
    ViewInfo(
        "ela", "compression", "Error level",
        "How much each area changes when the photo is saved again as JPEG. Areas with similar "
        "texture should glow similarly. A region that is much brighter or darker than comparable "
        "texture elsewhere was probably saved a different number of times.",
        "|image − JPEG(image, quality)|, maximum over RGB, amplified.",
        "Krawetz, 2007",
        param={**_QUALITY, "default": _DEFAULT_ELA_QUALITY},
    ),
    ViewInfo(
        "ghost", "compression", "JPEG ghost",
        "Bright areas were probably saved before at about the chosen quality. Sweep the slider: if "
        "one region lights up at a quality where the rest stays dark, it came from a different "
        "JPEG. Flat areas (sky, walls) glow at every quality and can be ignored.",
        "Block-averaged squared difference to a re-save at the chosen quality, inverted.",
        "Farid, 2009",
        param={**_QUALITY, "default": _DEFAULT_GHOST_QUALITY},
    ),
    ViewInfo(
        "boundary", "blending", "Blending boundary",
        "Bright lines mark where noise, sharpness and compression traces change abruptly, such as "
        "the seam of a face blended onto another head. Edges between different materials (sky "
        "and trees) also light up; look for a seam that follows no real edge, like a loop around "
        "a face.",
        "Gradient of block-wise noise, sharpness and error-level statistics (8×8 blocks).",
        "Idea from Li et al., 2020 (Face X-ray)",
    ),
    ViewInfo(
        "sharpness", "blending", "Sharpness",
        "How much fine detail each area has compared with the whole photo. Blue = blurrier, "
        "red = sharper. Face swaps are often generated at a lower resolution and look blue against "
        "a sharp background.",
        "Block-wise mean |Laplacian|, log ratio to the image median.",
        "Li & Lyu, 2019",
    ),
    ViewInfo(
        "fourier", "frequency", "Fourier spectrum",
        "Fine detail lies far from the center, coarse structure near it. Natural photos fade "
        "smoothly outwards. Bright isolated dots or a regular grid of dots are a classic trace of "
        "the upsampling layers in GAN and diffusion generators.",
        "log |FFT| of luminance with a Hann window, zero frequency centered.",
        "Zhang et al., 2019; Durall et al., 2020",
        space="spectrum",
    ),
    ViewInfo(
        "dct", "frequency", "DCT spectrum",
        "Zero frequency is in the top-left corner and frequency grows towards the bottom-right. "
        "Generated images often show a regular grid of bright points here.",
        "log |2D DCT-II| of luminance.",
        "Frank et al., 2020",
        space="spectrum",
    ),
    ViewInfo(
        "residual_spectrum", "frequency", "Noise spectrum",
        "The spectrum of the noise residual, with the normal falloff removed so only unusual energy "
        "remains. Camera noise looks like an even haze. Sharp peaks or a grid of points are "
        "periodic traces left by generators, resizing or JPEG.",
        "Power spectrum of the median-filter residual, in decades above its radial average.",
        "Corvi et al., 2023",
        space="spectrum",
    ),
]

VIEW_BY_ID = {v.id: v for v in VIEWS}


def catalog() -> dict:
    return {
        "tabs": [{"id": t, "label": label} for t, label in TABS],
        "views": [
            {
                "id": v.id, "tab": v.tab, "label": v.label, "look_for": v.look_for,
                "method": v.method, "reference": v.reference, "space": v.space, "param": v.param,
            }
            for v in VIEWS
        ],
    }


# --------------------------------------------------------------------------
# helpers

BLOCK = 8


def to_rgb8(pixels01: np.ndarray) -> np.ndarray:
    """Float [0,1] HxW or HxWx3 -> uint8 HxWx3."""
    arr = to_uint8(pixels01)
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    return np.ascontiguousarray(arr)


def luma(rgb8: np.ndarray) -> np.ndarray:
    """Luminance in 0..255 float32."""
    return rgb8.astype(np.float32) @ LUMA_WEIGHTS


def _stretch(x: np.ndarray, lo_pct: float = 0.5, hi_pct: float = 99.5, min_span: float = 1e-6) -> np.ndarray:
    lo, hi = np.percentile(x, [lo_pct, hi_pct])
    if hi - lo < min_span:
        hi = lo + min_span
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0)


def _lut(stops: list[tuple[float, tuple[int, int, int]]]) -> np.ndarray:
    xs = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops], dtype=np.float64)
    t = np.linspace(0.0, 1.0, 256)
    return np.stack([np.interp(t, xs, cols[:, c]) for c in range(3)], axis=-1).round().astype(np.uint8)


# perceptually ordered dark -> bright (magma-like); reads well on a dark UI
HEAT = _lut([
    (0.0, (0, 0, 4)), (0.25, (80, 18, 123)), (0.5, (182, 54, 121)),
    (0.75, (251, 136, 97)), (1.0, (252, 253, 191)),
])
# blue = below the image's norm, dark = typical, orange/red = above
DIVERGING = _lut([
    (0.0, (90, 170, 255)), (0.3, (40, 80, 160)), (0.5, (18, 20, 28)),
    (0.7, (170, 70, 30)), (1.0, (255, 170, 80)),
])


def heat(x01: np.ndarray) -> np.ndarray:
    return HEAT[to_uint8(x01)]


def diverging(log2_ratio: np.ndarray, limit: float = 2.0) -> np.ndarray:
    return DIVERGING[to_uint8((np.clip(log2_ratio, -limit, limit) + limit) / (2 * limit))]


def _jpeg_roundtrip(rgb8: np.ndarray, quality: int) -> np.ndarray:
    buf = BytesIO()
    Image.fromarray(rgb8).save(buf, "JPEG", quality=int(quality), subsampling=0)
    buf.seek(0)
    with Image.open(buf) as im:
        return np.asarray(im.convert("RGB"))


def _jpeg_error(rgb8: np.ndarray, quality: int) -> np.ndarray:
    """Per-pixel max-over-RGB absolute change after a JPEG re-save."""
    resaved = _jpeg_roundtrip(rgb8, quality)
    return np.abs(rgb8.astype(np.int16) - resaved.astype(np.int16)).max(axis=-1)


def _upsample(blocks: np.ndarray, h: int, w: int) -> np.ndarray:
    """Smoothly resize a block-level map back to the full image size."""
    im = Image.fromarray(blocks.astype(np.float32), mode="F")
    return np.asarray(im.resize((w, h), Image.BILINEAR), dtype=np.float32)


def _block_reduce(x: np.ndarray, func) -> np.ndarray:
    h8, w8 = x.shape[0] // BLOCK, x.shape[1] // BLOCK
    v = x[: h8 * BLOCK, : w8 * BLOCK].reshape(h8, BLOCK, w8, BLOCK).swapaxes(1, 2).reshape(h8, w8, -1)
    return func(v, axis=-1)


def noise_residual(gray: np.ndarray) -> np.ndarray:
    return gray - median_filter(gray, size=3, mode="reflect")


# Immerkaer (1996) noise estimation kernel: cancels local linear structure
_IMMERKAER = np.array([[1, -2, 1], [-2, 4, -2], [1, -2, 1]], dtype=np.float32)
_LAPLACE = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)


def block_features(rgb8: np.ndarray) -> dict[str, np.ndarray]:
    """Per-8x8-block statistics used by the noise-level, sharpness and boundary
    views and by the automatic checks. Values are natural logs."""
    gray = luma(rgb8)
    # noise: Immerkaer response, skipping the strongest edges so object
    # outlines don't masquerade as noise
    resp = np.abs(convolve(gray, _IMMERKAER, mode="reflect"))
    grad = np.hypot(sobel(gray, 0), sobel(gray, 1))
    flat = (grad <= np.percentile(grad, 80)).astype(np.float32)
    n_sum = _block_reduce(resp * flat, np.sum)
    n_cnt = _block_reduce(flat, np.sum)
    sigma = np.sqrt(np.pi / 2.0) / 6.0 * n_sum / np.maximum(n_cnt, 1.0)
    sigma[n_cnt < BLOCK] = np.nan  # too few flat pixels to estimate

    lap = np.abs(convolve(gray, _LAPLACE, mode="reflect"))
    sharp = _block_reduce(lap, np.mean)

    ela_b = _block_reduce(_jpeg_error(rgb8, _DEFAULT_ELA_QUALITY).astype(np.float32), np.mean)

    feats = {}
    for name, v in (("noise", sigma), ("sharpness", sharp), ("ela", ela_b)):
        v = np.log(np.maximum(v, 0.05))
        med = float(np.nanmedian(v)) if np.isfinite(v).any() else 0.0
        v = np.where(np.isfinite(v), v, med)
        feats[name] = median_filter(v, size=3, mode="nearest")
    return feats


def _robust_z(v: np.ndarray) -> np.ndarray:
    med = float(np.median(v))
    mad = float(np.median(np.abs(v - med))) * 1.4826
    return (v - med) / max(mad, 1e-3)


# --------------------------------------------------------------------------
# views

# Views built from block_features(); callers may pass cached features.
BLOCK_FEATURE_VIEWS = frozenset({"noise_level", "sharpness", "boundary"})


def render_view(view: str, rgb8: np.ndarray, quality: int | None = None, feats: dict | None = None) -> np.ndarray:
    """Render one forensic view. `feats` lets callers reuse block_features()."""
    if view not in VIEW_BY_ID:
        raise ValueError(f"Unknown view {view!r}; expected one of {sorted(VIEW_BY_ID)}")
    if view in BLOCK_FEATURE_VIEWS:
        return _BLOCK_RENDERERS[view](feats or block_features(rgb8), rgb8.shape[:2])
    if view in _QUALITY_RENDERERS:
        return _QUALITY_RENDERERS[view](rgb8, quality)
    return _PLAIN_RENDERERS[view](rgb8)


# color


def _render_luma(rgb8: np.ndarray) -> np.ndarray:
    return to_uint8(luma(rgb8) / 255.0)


def _channel_renderer(index: int):
    return lambda rgb8: rgb8[:, :, index].copy()


def _chroma_renderer(weights: tuple[float, float, float]):
    def render(rgb8: np.ndarray) -> np.ndarray:
        chroma = rgb8.astype(np.float32) @ np.array(weights, dtype=np.float32)
        return to_uint8(_stretch(chroma, min_span=8.0))

    return render


def _render_equalized(rgb8: np.ndarray) -> np.ndarray:
    ycc = np.asarray(Image.fromarray(rgb8).convert("YCbCr")).copy()
    y = ycc[:, :, 0]
    cdf = np.bincount(y.ravel(), minlength=256).astype(np.float64).cumsum()
    cdf = (cdf - cdf.min()) / max(cdf.max() - cdf.min(), 1.0)
    ycc[:, :, 0] = to_uint8(cdf[y])
    return np.asarray(Image.fromarray(ycc, mode="YCbCr").convert("RGB"))


# noise


def _render_noise(rgb8: np.ndarray) -> np.ndarray:
    res = np.abs(noise_residual(luma(rgb8)))
    # square root lifts faint grain in flat areas without saturating texture
    return to_uint8(np.sqrt(res / max(float(np.percentile(res, 99.5)), 2.0)))


# compression


def _render_ela(rgb8: np.ndarray, quality: int | None) -> np.ndarray:
    diff = _jpeg_error(rgb8, quality or _DEFAULT_ELA_QUALITY)
    return heat(diff / max(float(np.percentile(diff, 99.5)), 6.0))


def _render_ghost(rgb8: np.ndarray, quality: int | None) -> np.ndarray:
    resaved = _jpeg_roundtrip(rgb8, quality or _DEFAULT_GHOST_QUALITY).astype(np.float32)
    d = ((rgb8.astype(np.float32) - resaved) ** 2).mean(axis=-1)
    d = uniform_filter(d, size=2 * BLOCK, mode="reflect")
    span = float(d.max() - d.min())
    norm = (d - d.min()) / span if span > 1e-9 else np.zeros_like(d)
    return heat(1.0 - norm)


# blending (block features)


def _render_boundary(feats: dict, shape: tuple[int, int]) -> np.ndarray:
    grads = []
    for v in feats.values():
        gy, gx = np.gradient(gaussian_filter(_robust_z(v), 0.7))
        grads.append(gx**2 + gy**2)
    b = np.sqrt(np.mean(grads, axis=0))
    return heat(_upsample(b, *shape) / max(float(np.percentile(b, 99.5)), 1.0))


def _log_ratio_renderer(feature: str):
    def render(feats: dict, shape: tuple[int, int]) -> np.ndarray:
        v = gaussian_filter(feats[feature], 0.8)
        log2_ratio = (v - float(np.median(v))) / np.log(2.0)
        return diverging(_upsample(log2_ratio, *shape))

    return render


# frequency


def _render_fourier(rgb8: np.ndarray) -> np.ndarray:
    gray = luma(rgb8)
    mag = np.log1p(np.abs(np.fft.fftshift(compute_fft(gray - gray.mean(), window="hann"))))
    return heat(_stretch(mag, 1.0, 99.9))


def _render_dct(rgb8: np.ndarray) -> np.ndarray:
    gray = luma(rgb8)
    mag = np.log1p(np.abs(sfft.dctn(gray - gray.mean(), norm="ortho")))
    return heat(_stretch(mag, 1.0, 99.9))


def _render_residual_spectrum(rgb8: np.ndarray) -> np.ndarray:
    return heat(np.clip(residual_spectrum_decades(luma(rgb8)), 0.0, 2.5) / 2.5)


def residual_spectrum_decades(gray: np.ndarray, nbins: int = 192) -> np.ndarray:
    """Noise-residual power spectrum (centered), in decades above its radial median.

    The median (not the mean) per ring keeps a few strong peaks from lifting
    their whole ring and hiding each other.
    """
    log_psd = np.log10(power_spectrum(compute_fft(noise_residual(gray), window="hann")) + 1e-12)
    r = radius_grid(gray.shape)
    idx = np.minimum((r / r.max() * nbins).astype(np.int32), nbins - 1)
    present = np.unique(idx)
    med = np.asarray(nd_median(log_psd, labels=idx, index=present))
    return log_psd - np.interp(idx, present, med)


_PLAIN_RENDERERS = {
    "luma": _render_luma,
    "red": _channel_renderer(0),
    "green": _channel_renderer(1),
    "blue": _channel_renderer(2),
    "chroma_cb": _chroma_renderer((-0.168736, -0.331264, 0.5)),
    "chroma_cr": _chroma_renderer((0.5, -0.418688, -0.081312)),
    "equalized": _render_equalized,
    "noise": _render_noise,
    "fourier": _render_fourier,
    "dct": _render_dct,
    "residual_spectrum": _render_residual_spectrum,
}
_QUALITY_RENDERERS = {"ela": _render_ela, "ghost": _render_ghost}
_BLOCK_RENDERERS = {
    "noise_level": _log_ratio_renderer("noise"),
    "sharpness": _log_ratio_renderer("sharpness"),
    "boundary": _render_boundary,
}


# --------------------------------------------------------------------------
# automatic checks


def _largest_region(mask: np.ndarray, min_frac: float = 0.015, max_frac: float = 0.5) -> dict | None:
    """Bounding box (image pixels) of the largest connected group of flagged blocks."""
    if not mask.any():
        return None
    labels, _ = label(mask)
    sizes = np.bincount(labels.ravel())[1:]
    best = int(np.argmax(sizes)) + 1
    frac = float(sizes[best - 1]) / mask.size
    if not min_frac <= frac <= max_frac:  # specks, or "half the image" is not a local anomaly
        return None
    ys, xs = np.nonzero(labels == best)
    return {
        "x": int(xs.min() * BLOCK), "y": int(ys.min() * BLOCK),
        "w": int((xs.max() - xs.min() + 1) * BLOCK), "h": int((ys.max() - ys.min() + 1) * BLOCK),
        "fraction": round(frac, 4),
    }


def forensic_checks(rgb8: np.ndarray, feats: dict | None = None) -> list[dict]:
    """Local inconsistency checks. Each flag names the view that shows it.

    Only "missing noise" is flagged automatically. Every camera adds sensor
    noise everywhere, so in an untouched photo no unclipped area is far cleaner
    than the photo's own quiet areas. Generated or pasted content often is.
    Texture inflates noise estimates, so "noisier than the rest" is left to the
    reviewer, as are sharpness differences (depth of field causes them).
    """
    feats = feats or block_features(rgb8)
    noise = feats["noise"]
    if min(noise.shape) < 8:  # under 64 px: too small to judge
        return []
    brightness = _block_reduce(luma(rgb8), np.mean)[: noise.shape[0], : noise.shape[1]]
    valid = (brightness > 12) & (brightness < 243)  # clipped areas carry no noise
    if valid.sum() < 16:
        return []
    floor = float(np.percentile(noise[valid], 30))
    region = _largest_region(valid & (noise < floor - np.log(2.5)))
    if not region:
        return []
    return [{
        "type": "missing_noise",
        "view": "noise_level",
        "severity": round(min(1.0, 0.55 + region["fraction"] * 5), 2),
        "title": "A region has almost no camera noise",
        "explanation": (
            f"About {region['fraction']:.0%} of the image is far cleaner than the quietest normal "
            "parts of the photo. Cameras add noise everywhere, so generated, pasted or heavily "
            "retouched content is the usual cause. Strong denoising of one area does the same."
        ),
        "region": {k: region[k] for k in ("x", "y", "w", "h")},
    }]


def spectrum_profile(rgb8: np.ndarray, nbins: int = 48) -> dict:
    """Azimuthally averaged power spectrum with its 1/f^alpha fit, for the chart."""
    gray = luma(rgb8) / 255.0
    psd = power_spectrum(compute_fft(gray - gray.mean(), window="hann"))
    freqs, power = radial_profile(psd, nbins=nbins)
    alpha, r2 = spectral_slope(freqs, power)
    keep = power > 0
    freqs, power = freqs[keep], power[keep]
    sel = (freqs >= 0.02) & (freqs <= 0.7)
    fit = None
    if np.isfinite(alpha) and sel.sum() >= 4:
        c = float(np.median(np.log10(power[sel]) + alpha * np.log10(freqs[sel])))
        fit = [round(c - alpha * float(np.log10(f)), 4) for f in freqs]
    return {
        "freqs": [round(float(f), 5) for f in freqs],
        "log_power": [round(float(np.log10(p)), 4) for p in power],
        "fit": fit,
        "alpha": None if not np.isfinite(alpha) else round(alpha, 3),
        "r2": round(r2, 3),
    }
