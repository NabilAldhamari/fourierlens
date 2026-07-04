#!/usr/bin/env sh
# FourierLens one-click launcher (macOS / Linux).
# Prefers uv (no global installs); falls back to pip in a local venv.
cd "$(dirname "$0")" || exit 1

if command -v uv >/dev/null 2>&1; then
    exec uv run fourierlens
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3.10+ is required. Install it via your package manager or https://www.python.org/downloads/"
    exit 1
fi

if [ ! -d .venv ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    ./.venv/bin/python -m pip install --quiet -e .
fi
exec ./.venv/bin/python -m fourierlens.cli serve
