#!/usr/bin/env python3
"""Build the local place index from a UTF-8 TSV exported from OSM tooling.

Input columns: name,kind,lat,lon,source_id. Extra columns are ignored.
"""
import csv, os, sqlite3, sys

if len(sys.argv) != 3:
    raise SystemExit("usage: import_places.py places.tsv data/places.sqlite3")
source, target = sys.argv[1:]
os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
tmp = target + ".tmp"
if os.path.exists(tmp): os.unlink(tmp)
with sqlite3.connect(tmp) as db:
    db.execute("CREATE VIRTUAL TABLE places USING fts5(name, kind, lat UNINDEXED, lon UNINDEXED, source_id UNINDEXED, tokenize='unicode61 remove_diacritics 2')")
    with open(source, encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh, delimiter="\t")
        required = {"name", "kind", "lat", "lon", "source_id"}
        if not required.issubset(reader.fieldnames or set()):
            raise SystemExit("TSV must contain name, kind, lat, lon, source_id columns")
        batch = []
        for row in reader:
            if not row["name"] or len(row["name"]) > 240: continue
            batch.append((row["name"], row["kind"][:80], float(row["lat"]), float(row["lon"]), row["source_id"][:160]))
            if len(batch) >= 1000:
                db.executemany("INSERT INTO places VALUES (?,?,?,?,?)", batch); batch.clear()
        if batch: db.executemany("INSERT INTO places VALUES (?,?,?,?,?)", batch)
    db.commit()
os.replace(tmp, target)
