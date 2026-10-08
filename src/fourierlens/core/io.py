"""Image loading, normalization to float32 [0, 1], and metadata extraction."""

from __future__ import annotations

import hashlib
import io as _stdio
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

Image.MAX_IMAGE_PIXELS = 512 * 1024 * 1024  # allow large scientific images

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}

# Rec. 709 luma weights
LUMA_WEIGHTS = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

_CHANNEL_INDEX = {"r": 0, "g": 1, "b": 2}
CHANNEL_MODES = ("luma", *_CHANNEL_INDEX)


@dataclass
class LoadedImage:
    """Normalized pixel data plus everything a researcher may want to export."""

    pixels: np.ndarray  # float32, HxW (grayscale) or HxWx3 (RGB), range [0, 1]
    meta: dict


def _normalize_array(arr: np.ndarray) -> tuple[np.ndarray, int]:
    """Convert an integer/float image array to float32 in [0, 1]; return (array, bit_depth)."""
    if arr.dtype == np.uint8:
        return arr.astype(np.float32) / 255.0, 8
    if arr.dtype == np.uint16:
        return arr.astype(np.float32) / 65535.0, 16
    if arr.dtype == np.uint32:
        return arr.astype(np.float32) / np.float32(2**32 - 1), 32
    if arr.dtype in (np.int16, np.int32):
        bit_depth = arr.itemsize * 8
        arr = arr.astype(np.float64)
        lo, hi = arr.min(), arr.max()
        span = (hi - lo) if hi > lo else 1.0
        return ((arr - lo) / span).astype(np.float32), bit_depth
    if np.issubdtype(arr.dtype, np.floating):
        arr = np.nan_to_num(arr.astype(np.float32))
        hi = float(arr.max()) if arr.size else 1.0
        if hi > 1.0:
            arr = arr / hi
        return np.clip(arr, 0.0, 1.0), 32
    raise ValueError(f"Unsupported image dtype: {arr.dtype}")


def _collapse_channels(arr: np.ndarray) -> np.ndarray:
    """Reduce an array to HxW or HxWx3."""
    if arr.ndim == 2:
        return arr
    if arr.ndim == 3:
        if arr.shape[2] <= 2:  # gray, or gray + alpha
            return arr[:, :, 0]
        return arr[:, :, :3]  # drop alpha / extra channels
    raise ValueError(f"Unsupported image shape: {arr.shape}")


# IJG standard luminance quantization table (quality 50)
_IJG_LUMA = (
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
)
_EXIF_TAGS = {271: "camera_make", 272: "camera_model", 305: "software", 306: "date_time"}
# metadata keys AI image tools write into PNG/WebP text chunks
_GENERATOR_KEYS = ("parameters", "prompt", "workflow", "invokeai_metadata", "sd-metadata", "dream")


def jpeg_quality(quantization: dict | None) -> int | None:
    """Estimate the IJG quality factor from the luminance quantization table."""
    if not quantization or 0 not in quantization:
        return None
    scale = 100.0 * sum(quantization[0]) / sum(_IJG_LUMA)
    q = (200.0 - scale) / 2.0 if scale <= 100.0 else 5000.0 / scale
    return int(round(min(max(q, 1.0), 100.0)))


def _file_facts(im: Image.Image) -> dict:
    """Metadata a forensic reviewer wants first: compression level, camera, editing software."""
    facts: dict = {"jpeg_quality": jpeg_quality(getattr(im, "quantization", None))}
    try:
        exif = im.getexif()
    except Exception:  # noqa: BLE001 - malformed EXIF must not block loading
        exif = {}
    facts["has_exif"] = bool(exif)
    for tag, key in _EXIF_TAGS.items():
        value = exif.get(tag) if exif else None
        if isinstance(value, bytes):
            value = value.decode("utf-8", "replace")
        if value:
            facts[key] = str(value).strip("\x00 ")[:120]
    keys = [k for k in im.info if str(k).lower() in _GENERATOR_KEYS]
    if keys:
        facts["generator_metadata"] = sorted(str(k) for k in keys)
    return facts


def _check_pixels(width: int, height: int, max_pixels: int | None) -> None:
    if max_pixels is not None and width * height > max_pixels:
        raise ValueError(
            f"Image is {width}x{height} ({width * height / 1e6:.0f} MP); "
            f"the limit is {max_pixels / 1e6:.0f} MP"
        )


def load_image_bytes(data: bytes, filename: str = "image", max_pixels: int | None = None) -> LoadedImage:
    """Load an image from raw file bytes. Supports 8-bit web formats and 16/32-bit TIFF.

    max_pixels rejects oversized images from the header, before any decode.
    """
    ext = Path(filename).suffix.lower()
    sha = hashlib.sha256(data).hexdigest()[:16]

    if ext in (".tif", ".tiff"):
        if max_pixels is not None:
            with tifffile.TiffFile(_stdio.BytesIO(data)) as tf:
                shape = tf.series[0].shape
            _check_pixels(shape[1] if len(shape) > 1 else 1, shape[0], max_pixels)
        raw = tifffile.imread(_stdio.BytesIO(data))
        raw = _collapse_channels(np.asarray(raw))
        pixels, bit_depth = _normalize_array(raw)
        fmt = "TIFF"
        facts = {}
    else:
        with Image.open(_stdio.BytesIO(data)) as im:
            _check_pixels(im.width, im.height, max_pixels)
            fmt = im.format or ext.lstrip(".").upper()
            facts = _file_facts(im)
            if im.mode in ("I;16", "I;16B", "I;16L", "I"):
                raw = np.asarray(im, dtype=np.uint16 if "16" in im.mode else np.int32)
            elif im.mode in ("L", "RGB"):
                raw = np.asarray(im)
            elif im.mode in ("LA", "P", "1"):
                raw = np.asarray(im.convert("L") if im.mode == "1" else im.convert("RGB"))
            else:
                raw = np.asarray(im.convert("RGB"))
        raw = _collapse_channels(raw)
        pixels, bit_depth = _normalize_array(raw)

    h, w = pixels.shape[:2]
    meta = {
        "filename": Path(filename).name,
        "format": fmt,
        "width": w,
        "height": h,
        "aspect_ratio": round(w / h, 4) if h else None,
        "megapixels": round(w * h / 1e6, 3),
        "n_channels": 1 if pixels.ndim == 2 else pixels.shape[2],
        "bit_depth": bit_depth,
        "file_size_bytes": len(data),
        "sha256": sha,
        **facts,
    }
    return LoadedImage(pixels=pixels, meta=meta)


def load_image(path: str | Path) -> LoadedImage:
    """Load an image from disk."""
    path = Path(path)
    img = load_image_bytes(path.read_bytes(), path.name)
    img.meta["path"] = str(path)
    return img


def to_channel(pixels: np.ndarray, mode: str = "luma") -> np.ndarray:
    """Extract a single 2D float32 channel from a normalized image array."""
    if pixels.ndim == 2:
        return pixels
    if mode == "luma":
        return pixels @ LUMA_WEIGHTS
    if mode not in _CHANNEL_INDEX:
        raise ValueError(f"Unknown channel mode {mode!r}; expected one of {CHANNEL_MODES}")
    idx = _CHANNEL_INDEX[mode]
    return np.ascontiguousarray(pixels[:, :, idx])


def iter_image_files(root: str | Path, recursive: bool = False):
    """Yield supported image file paths under a directory, sorted for determinism."""
    root = Path(root)
    pattern = "**/*" if recursive else "*"
    for p in sorted(root.glob(pattern)):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
            yield p
