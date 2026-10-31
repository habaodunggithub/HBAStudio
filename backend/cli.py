"""Portable entry point for a source checkout or an installed backend wheel."""

import argparse

from . import __version__, config


def main():
    parser = argparse.ArgumentParser(description="Run the HBA Studio local workspace")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--reload", action="store_true", help="Reload backend code during development")
    args = parser.parse_args()
    import uvicorn

    uvicorn.run("backend.app:app", host="127.0.0.1", port=config.PORT, reload=args.reload, access_log=False)


if __name__ == "__main__":
    main()
