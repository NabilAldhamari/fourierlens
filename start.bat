@echo off
rem FourierLens one-click launcher (Windows).
rem Prefers uv (no global installs); falls back to pip in a local venv.
cd /d "%~dp0"

where uv >nul 2>nul
if %errorlevel%==0 (
    uv run fourierlens
    goto :eof
)

where python >nul 2>nul
if not %errorlevel%==0 (
    echo Python 3.10+ is required. Install it from https://www.python.org/downloads/
    pause
    goto :eof
)

if not exist .venv (
    echo Creating virtual environment...
    python -m venv .venv
    .venv\Scripts\python.exe -m pip install --quiet -e .
)
.venv\Scripts\python.exe -m fourierlens.cli serve
pause
