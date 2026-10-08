"""Generate the bundled sample gallery (run once; outputs are committed).

The samples are synthetic, so they carry no real faces and no licensing
questions, but each reproduces the traces a real manipulation leaves:

    authentic   - "camera photo": scene + even sensor noise, saved once as JPEG q90
    blended     - same scene with an oval patch blended in the way face swaps are:
                  lower resolution, no sensor noise, compressed earlier at q65,
                  feathered seam; then saved as JPEG q92
    generated   - "generator output": content upsampled 4x by a transposed
                  convolution (checkerboard periodicity), PNG with prompt metadata
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, PngImagePlugin
from scipy.ndimage import gaussian_filter

W, H = 768, 512
OUT = Path(__file__).resolve().parents[1] / "samples"
RNG = np.random.default_rng(7)


def pink(h: int, w: int, alpha: float = 2.0) -> np.ndarray:
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    r = np.hypot(fy, fx)
    r[0, 0] = 1.0
    amp = 1.0 / r ** (alpha / 2.0)
    amp[0, 0] = 0.0
    field = np.fft.ifft2(amp * np.exp(1j * RNG.uniform(0, 2 * np.pi, (h, w)))).real
    return (field - field.mean()) / field.std()


def scene() -> np.ndarray:
    """A clean landscape: sky gradient, textured hills, a sun."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    img = np.zeros((H, W, 3))
    sky = np.clip(y / (H * 0.55), 0, 1)[..., None]
    img[:] = (1 - sky) * np.array([0.35, 0.55, 0.85]) + sky * np.array([0.75, 0.85, 0.95])
    sun = np.exp(-((x - 600) ** 2 + (y - 90) ** 2) / (2 * 28.0**2))[..., None]
    img = img * (1 - sun) + sun * np.array([1.0, 0.95, 0.8])

    horizon = H * 0.5 + 40 * np.sin(x / 110.0) + 18 * np.sin(x / 37.0 + 1.0)
    ground = gaussian_filter((y > horizon).astype(float), 1.2)[..., None]
    tex = pink(H, W, 2.4)
    grass = np.stack([0.32 + 0.07 * tex, 0.45 + 0.08 * tex, 0.2 + 0.04 * tex], axis=-1)
    shade = np.clip((y - horizon) / (H * 0.5), 0, 1)[..., None]
    grass = grass * (1.0 - 0.35 * shade)
    img = img * (1 - ground) + ground * grass
    return np.clip(img, 0, 1)


def jpeg(img01: np.ndarray, quality: int) -> np.ndarray:
    buf = BytesIO()
    Image.fromarray((np.clip(img01, 0, 1) * 255 + 0.5).astype(np.uint8)).save(buf, "JPEG", quality=quality)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert("RGB"), dtype=np.float64) / 255.0


def sensor_noise(shape) -> np.ndarray:
    return RNG.normal(0, 5.0 / 255, shape)


def save_jpeg(name: str, img01: np.ndarray, quality: int) -> None:
    path = OUT / f"{name}.jpg"
    Image.fromarray((np.clip(img01, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, "JPEG", quality=quality)
    print(f"  wrote {path.name}")


def blended_patch(base: np.ndarray) -> np.ndarray:
    """Blend an oval patch the way face-swap pipelines do."""
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    cx, cy, rx, ry = 300, 330, 70, 92
    inside = (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2) <= 1.0
    alpha = gaussian_filter(inside.astype(float), 6.0)[..., None]  # feathered seam

    # "generated face": skin-toned shading + texture, rendered at half resolution
    tex = pink(H // 2, W // 2, 2.2)
    yy, xx = np.mgrid[0 : H // 2, 0 : W // 2]
    light = 0.12 * np.cos((xx - cx / 2) / 30.0)
    small = np.stack([0.78 + light + 0.05 * tex, 0.6 + light + 0.04 * tex, 0.5 + light + 0.035 * tex], axis=-1)
    small8 = (np.clip(small, 0, 1) * 255 + 0.5).astype(np.uint8)
    face = np.asarray(Image.fromarray(small8).resize((W, H), Image.BICUBIC), dtype=np.float64) / 255.0
    face = jpeg(face, 65)  # comes from a different, more compressed source

    out = base * (1 - alpha) + face * alpha
    return out + sensor_noise(out.shape) * (1 - alpha)  # the camera noise stops at the seam


def generated(base: np.ndarray) -> Image.Image:
    """Upsample low-res content with a transposed convolution, as many generators do."""
    base8 = (np.clip(base, 0, 1) * 255 + 0.5).astype(np.uint8)
    small = np.asarray(Image.fromarray(base8).resize((W // 4, H // 4), Image.LANCZOS), dtype=np.float64) / 255.0
    up = np.zeros((H, W, 3))
    up[::4, ::4] = small  # zero insertion (stride 4)
    k1 = np.array([0.3, 0.55, 0.75, 1.0, 0.7, 0.5, 0.25])  # learned kernels are not ideal interpolators
    k = np.outer(k1, k1)
    from scipy.ndimage import convolve

    for c in range(3):
        up[:, :, c] = convolve(up[:, :, c], k, mode="wrap") * 16 / k.sum()
    img = Image.fromarray((np.clip(up, 0, 1) * 255 + 0.5).astype(np.uint8))
    return img


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for old in OUT.iterdir():
        if old.is_file():
            old.unlink()
    base = scene()
    save_jpeg("authentic", base + sensor_noise(base.shape), 90)
    save_jpeg("blended", blended_patch(base), 95)

    info = PngImagePlugin.PngInfo()
    info.add_text("parameters", "a field of grass at sunset, Steps: 30, Sampler: Euler a, CFG scale: 7 (synthetic sample)")
    generated(base).save(OUT / "generated.png", pnginfo=info)
    print("  wrote generated.png")


if __name__ == "__main__":
    main()
