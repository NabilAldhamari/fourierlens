"""Generate the bundled sample gallery (run once; outputs are committed).

Each sample is designed to teach something specific about the frequency domain
or to trigger one of the anomaly detectors:

    grating          - single sinusoid: two conjugate dots in the spectrum
    gratings_mix     - three sinusoids at different frequencies/orientations
    checkerboard     - harmonics of a square wave
    natural          - 1/f^2 pink noise: statistics of natural photographs
    shapes           - edges and flat regions: energy along edge normals
    periodic_noise   - natural image + sinusoidal interference (peak detector demo)
    jpeg_artifacts   - heavily compressed JPEG (grid detector demo)
    upscaled         - 4x bicubic upscale (steep-slope / low-detail demo)
    sharpened        - over-sharpened natural image (flat-spectrum demo)
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 512
OUT = Path(__file__).resolve().parents[1] / "samples"
RNG = np.random.default_rng(42)


def save(name: str, arr01: np.ndarray, fmt: str = "PNG", **kwargs) -> None:
    img = Image.fromarray((np.clip(arr01, 0, 1) * 255).astype(np.uint8))
    path = OUT / f"{name}.{fmt.lower().replace('jpeg', 'jpg')}"
    img.save(path, fmt, **kwargs)
    print(f"  wrote {path.name}")


def coords() -> tuple[np.ndarray, np.ndarray]:
    y, x = np.mgrid[0:SIZE, 0:SIZE].astype(np.float64)
    return y, x


def pink_noise(alpha: float = 2.0) -> np.ndarray:
    """1/f^alpha noise field, normalized to [0, 1] - mimics natural image statistics."""
    fy = np.fft.fftfreq(SIZE)[:, None]
    fx = np.fft.fftfreq(SIZE)[None, :]
    r = np.hypot(fy, fx)
    r[0, 0] = 1.0
    amplitude = 1.0 / r ** (alpha / 2.0)
    amplitude[0, 0] = 0.0
    phase = RNG.uniform(0, 2 * np.pi, (SIZE, SIZE))
    field = np.fft.ifft2(amplitude * np.exp(1j * phase)).real
    field = (field - field.min()) / (field.max() - field.min())
    return field


def main() -> None:
    OUT.mkdir(exist_ok=True)
    y, x = coords()

    # single grating: 12 cycles across, 30 degrees
    theta = np.radians(30)
    f = 12 / SIZE
    grating = 0.5 + 0.4 * np.sin(2 * np.pi * f * (x * np.cos(theta) + y * np.sin(theta)))
    save("grating", grating)

    mix = (
        0.5
        + 0.20 * np.sin(2 * np.pi * (8 / SIZE) * x)
        + 0.15 * np.sin(2 * np.pi * (24 / SIZE) * (x * np.cos(np.radians(60)) + y * np.sin(np.radians(60))))
        + 0.10 * np.sin(2 * np.pi * (48 / SIZE) * y)
    )
    save("gratings_mix", mix)

    check = (((x // 32).astype(int) + (y // 32).astype(int)) % 2).astype(np.float64)
    save("checkerboard", check)

    natural = pink_noise(2.0)
    save("natural", natural)

    shapes_img = Image.new("L", (SIZE, SIZE), 40)
    d = ImageDraw.Draw(shapes_img)
    d.rectangle([60, 80, 220, 240], fill=200)
    d.ellipse([260, 120, 460, 320], fill=140)
    d.rectangle([120, 320, 420, 380], fill=230)
    d.polygon([(80, 470), (180, 300), (280, 470)], fill=90)
    save("shapes", np.asarray(shapes_img, dtype=np.float64) / 255.0)

    interference = 0.12 * np.sin(2 * np.pi * (56 / SIZE) * (x * np.cos(np.radians(15)) + y * np.sin(np.radians(15))))
    save("periodic_noise", np.clip(natural * 0.85 + 0.075 + interference, 0, 1))

    jpeg_src = Image.fromarray((np.clip(pink_noise(1.9), 0, 1) * 255).astype(np.uint8))
    jpeg_src.save(OUT / "jpeg_artifacts.jpg", "JPEG", quality=12)
    print("  wrote jpeg_artifacts.jpg")

    small = Image.fromarray((pink_noise(2.0)[:128, :128] * 255).astype(np.uint8))
    up = small.resize((SIZE, SIZE), Image.BICUBIC)
    save("upscaled", np.asarray(up, dtype=np.float64) / 255.0)

    sharp = Image.fromarray((natural * 255).astype(np.uint8)).filter(
        ImageFilter.UnsharpMask(radius=2, percent=400, threshold=0)
    )
    noisy = np.asarray(sharp, dtype=np.float64) / 255.0 + RNG.normal(0, 0.06, (SIZE, SIZE))
    save("sharpened", np.clip(noisy, 0, 1))


if __name__ == "__main__":
    main()
