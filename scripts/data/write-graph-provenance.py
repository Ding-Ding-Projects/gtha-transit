#!/usr/bin/env python3
"""Bind public provenance to the exact feed snapshot consumed by a graph build."""
import argparse, datetime, json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--manifest", type=Path, required=True)
parser.add_argument("--graph", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
graph_time = datetime.datetime.fromtimestamp(args.graph.stat().st_mtime, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
payload = {"source": "OpenTripPlanner", "updatedAt": manifest.get("generatedAt"), "graphBuiltAt": graph_time, "timezone": "America/Toronto", "feeds": [{key: feed.get(key) for key in ("id", "sha256", "serviceStart", "serviceEnd")} for feed in manifest.get("feeds", [])]}
args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
