#!/usr/bin/env python3
"""Download and validate the configured official GTFS feeds atomically."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import tempfile
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

MAX_FEED_BYTES = 600 * 1024 * 1024
REQUIRED = {"agency.txt", "stops.txt", "routes.txt", "trips.txt", "stop_times.txt"}


def download(url: str, destination: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    request = urllib.request.Request(url, headers={"User-Agent": "GTHATransitFeedFetcher/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, destination.open("wb") as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FEED_BYTES:
                raise ValueError(f"feed exceeds {MAX_FEED_BYTES} bytes")
            digest.update(chunk)
            output.write(chunk)
    return size, digest.hexdigest()


def calendar_range(archive: zipfile.ZipFile) -> tuple[str | None, str | None]:
    dates: list[str] = []
    if "calendar.txt" in archive.namelist():
        with archive.open("calendar.txt") as raw:
            for row in csv.DictReader(line.decode("utf-8-sig") for line in raw):
                dates.extend(value for value in (row.get("start_date"), row.get("end_date")) if value)
    if "calendar_dates.txt" in archive.namelist():
        with archive.open("calendar_dates.txt") as raw:
            dates.extend(row.get("date", "") for row in csv.DictReader(line.decode("utf-8-sig") for line in raw))
    dates = [value for value in dates if len(value) == 8 and value.isdigit()]
    return (min(dates), max(dates)) if dates else (None, None)


def validate(path: Path) -> dict[str, object]:
    if path.read_bytes()[:4] != b"PK\x03\x04":
        raise ValueError("download is not a ZIP archive")
    with zipfile.ZipFile(path) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f"corrupt member: {bad}")
        names = {Path(name).name for name in archive.namelist()}
        missing = sorted(REQUIRED - names)
        if missing:
            raise ValueError(f"missing required GTFS files: {', '.join(missing)}")
        earliest, latest = calendar_range(archive)
        return {"members": len(archive.namelist()), "serviceStart": earliest, "serviceEnd": latest}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--attempts", type=int, default=3)
    args = parser.parse_args()
    registry = json.loads(args.registry.read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="gtha-feeds-", dir=args.output) as temp_root:
        temp = Path(temp_root)
        for agency in registry["agencies"]:
            url = agency.get("downloadUrl")
            if not url:
                raise ValueError(f"{agency['id']} has no downloadUrl")
            partial = temp / f"{agency['id']}.zip"
            last_error: Exception | None = None
            for attempt in range(1, args.attempts + 1):
                try:
                    size, sha256 = download(url, partial)
                    details = validate(partial)
                    break
                except Exception as error:
                    last_error = error
                    partial.unlink(missing_ok=True)
                    if attempt < args.attempts:
                        time.sleep(attempt * 2)
            else:
                raise RuntimeError(f"failed to fetch {agency['id']}: {last_error}")
            target = args.output / f"{agency['id']}.zip"
            os.replace(partial, target)
            manifest.append({
                "id": agency["id"], "name": agency["name"], "source": url,
                "file": target.name, "bytes": size, "sha256": sha256, **details,
            })
            print(f"validated {agency['id']}: {size} bytes, {details['members']} members", flush=True)
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "feeds": manifest,
    }
    manifest_path = args.output / "manifest.json"
    staged = args.output / ".manifest.json.tmp"
    staged.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(staged, manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
