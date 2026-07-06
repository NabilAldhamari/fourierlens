"""Enable `python -m fourierlens` as an alias for the CLI entry point."""

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
