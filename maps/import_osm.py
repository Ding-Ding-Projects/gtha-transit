#!/usr/bin/env python3
"""Extract real OSM roads, water, and named nodes into a local SQLite index."""
import json, os, sqlite3, sys
import osmium

class Handler(osmium.SimpleHandler):
    def __init__(self, db): super().__init__(); self.db=db
    def way(self, obj):
        try: line=[[float(n.lon),float(n.lat)] for n in obj.nodes]
        except (AttributeError,RuntimeError): return
        if len(line)<2:return
        kind=obj.tags.get('highway'); water=obj.tags.get('waterway') or obj.tags.get('natural')
        if kind:self.db.execute('INSERT INTO roads VALUES (?,?,?)',(str(obj.id),kind,json.dumps(line,separators=(',',':'))))
        if water in ('river','stream','canal','coastline','water'):
            self.db.execute('INSERT INTO water VALUES (?,?,?)',(str(obj.id),water,json.dumps(line,separators=(',',':'))))
    def node(self,obj):
        name=obj.tags.get('name')
        if name:self.db.execute('INSERT INTO places VALUES (?,?,?,?,?)',(name,obj.tags.get('place') or obj.tags.get('amenity') or 'place',float(obj.location.lat),float(obj.location.lon),f'node/{obj.id}'))

if len(sys.argv)!=3:raise SystemExit('usage: import_osm.py input.osm.pbf data/places.sqlite3')
source,target=sys.argv[1:]; os.makedirs(os.path.dirname(os.path.abspath(target)),exist_ok=True); tmp=target+'.tmp'
if os.path.exists(tmp):os.unlink(tmp)
db=sqlite3.connect(tmp); db.executescript('CREATE TABLE roads(id TEXT PRIMARY KEY,kind TEXT,geometry TEXT); CREATE TABLE water(id TEXT PRIMARY KEY,kind TEXT,geometry TEXT); CREATE VIRTUAL TABLE places USING fts5(name,kind,lat UNINDEXED,lon UNINDEXED,source_id UNINDEXED);')
Handler(db).apply_file(source,locations=True); db.commit(); db.close(); os.replace(tmp,target)
