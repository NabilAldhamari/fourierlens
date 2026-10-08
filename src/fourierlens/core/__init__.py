"""Pure-NumPy compute core: no web dependencies.

Modules:
    io        - image loading/normalization and file facts (JPEG quality, EXIF)
    forensics - pixel-level forensic views and local inconsistency checks
    windows   - 2D window functions (Hann, Hamming, Blackman, Tukey)
    fft       - spectra helpers
    metrics   - scalar/profile spectral metrics for research export
    anomalies - automatic spectral anomaly detectors with explanations
    batch     - headless dataset analysis used by the CLI
"""
