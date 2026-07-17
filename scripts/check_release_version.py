"""Verify that all public Aura release version declarations agree."""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_toml(relative_path: str) -> dict:
    with (ROOT / relative_path).open("rb") as handle:
        return tomllib.load(handle)


def declared_versions() -> dict[str, str]:
    cargo = read_toml("Cargo.toml")
    pyproject = read_toml("pyproject.toml")
    init_text = (ROOT / "python" / "aura" / "__init__.py").read_text(encoding="utf-8")
    init_match = re.search(r'^__version__\s*=\s*["\']([^"\']+)["\']', init_text, re.MULTILINE)
    if init_match is None:
        raise ValueError("python/aura/__init__.py has no __version__ declaration")

    return {
        "Cargo.toml": cargo["package"]["version"],
        "pyproject.toml": pyproject["project"]["version"],
        "python/aura/__init__.py": init_match.group(1),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--expected",
        help="Expected release version or tag (for example 1.5.6 or v1.5.6)",
    )
    args = parser.parse_args()

    try:
        versions = declared_versions()
    except (KeyError, OSError, ValueError, tomllib.TOMLDecodeError) as error:
        print(f"release version check failed: {error}", file=sys.stderr)
        return 1

    unique_versions = set(versions.values())
    if len(unique_versions) != 1:
        for source, version in versions.items():
            print(f"{source}: {version}", file=sys.stderr)
        print("release version declarations do not match", file=sys.stderr)
        return 1

    version = unique_versions.pop()
    expected = args.expected.removeprefix("v") if args.expected else None
    if expected is not None and version != expected:
        print(
            f"release tag/version mismatch: tag={args.expected!r}, package={version!r}",
            file=sys.stderr,
        )
        return 1

    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    if re.search(rf"^##\s+{re.escape(version)}\s*$", changelog, re.MULTILINE) is None:
        print(f"CHANGELOG.md has no release heading for {version}", file=sys.stderr)
        return 1

    print(f"Aura release metadata is consistent: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
