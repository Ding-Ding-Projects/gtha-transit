#!/usr/bin/env python3
"""Refuse a refresh when root feed bytes no longer match the active graph provenance."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> None:
    raise ValueError(message)


def contained(root: Path, name: object) -> Path:
    if not isinstance(name, str) or not name or Path(name).name != name:
        fail("manifest feed file is invalid")
    path = (root / name).resolve()
    if path.parent != root.resolve():
        fail("manifest feed file escapes feed directory")
    return path


def verify(provenance_path: Path, manifest_path: Path, feeds_dir: Path) -> int:
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    active = provenance.get("feeds")
    if not isinstance(active, list) or not active:
        fail("active graph provenance has no feed versions")
    indexed = {}
    for entry in manifest.get("feeds", []):
        identifier = entry.get("id")
        if not isinstance(identifier, str) or identifier in indexed:
            fail("manifest has invalid or duplicate feed version")
        indexed[identifier] = entry
    for entry in active:
        identifier, expected = entry.get("id"), entry.get("sha256")
        if not isinstance(identifier, str) or not isinstance(expected, str) or len(expected) != 64:
            fail("active graph provenance has invalid feed version")
        source = indexed.get(identifier)
        if source is None:
            fail(f"missing active graph feed version: {identifier}")
        if source.get("sha256") != expected:
            fail(f"manifest digest differs from active graph: {identifier}")
        archive = contained(feeds_dir, source.get("file"))
        if not archive.is_file():
            fail(f"missing active graph archive: {identifier}")
        if sha256(archive) != expected:
            fail(f"archive digest differs from active graph: {identifier}")
    print(f"active graph feed provenance verified: {len(active)} versions")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--graph-provenance", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--feeds-dir", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        raise SystemExit(verify(arguments.graph_provenance, arguments.manifest, arguments.feeds_dir))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"active graph feed provenance mismatch: {error}")
        raise SystemExit(1)
