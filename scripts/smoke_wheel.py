"""Install a built wheel into a clean venv and check it actually works.

    python scripts/smoke_wheel.py dist/fourierlens-*.whl
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


def main(wheel: str) -> int:
    with tempfile.TemporaryDirectory() as tmp:
        venv = Path(tmp) / "venv"
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
        bindir = venv / ("Scripts" if sys.platform == "win32" else "bin")
        py = bindir / ("python.exe" if sys.platform == "win32" else "python")
        subprocess.run([str(py), "-m", "pip", "install", "--quiet", wheel], check=True)

        # bundled assets must be inside the wheel, not only in the source checkout
        probe = (
            "from pathlib import Path; import fourierlens;"
            "root = Path(fourierlens.__file__).parent;"
            "assert (root / 'webui' / 'index.html').is_file(), 'webui bundle missing';"
            "assert any((root / 'samples').glob('*.png')), 'samples missing';"
            "print(fourierlens.__version__)"
        )
        version = subprocess.run([str(py), "-c", probe], check=True, capture_output=True, text=True).stdout.strip()
        print(f"installed fourierlens {version}")

        server = subprocess.Popen(
            [str(py), "-m", "fourierlens", "serve", "--no-browser", "--port", "8399"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            for _ in range(40):
                try:
                    with urllib.request.urlopen("http://127.0.0.1:8399/api/health", timeout=2) as r:
                        health = json.load(r)
                    break
                except OSError:
                    time.sleep(0.5)
            else:
                print("server did not start", file=sys.stderr)
                return 1
            assert health["ok"] and health["version"] == version, health
            with urllib.request.urlopen("http://127.0.0.1:8399/", timeout=5) as r:
                assert b"<div id=\"root\"" in r.read(), "web UI not served"
        finally:
            server.terminate()
    print("wheel smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
