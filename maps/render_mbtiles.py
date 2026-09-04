#!/usr/bin/env python3
"""Render extracted OSM linework to real PNG MBTiles using Pillow."""
import io,json,math,os,sqlite3,sys
from PIL import Image,ImageDraw
def proj(lon,lat,z):
 n=1<<z; return (lon+180)/360*n,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n
def main(src,target):
 db=sqlite3.connect(src); out=sqlite3.connect(target); out.executescript('CREATE TABLE IF NOT EXISTS metadata(name TEXT,value TEXT); CREATE TABLE IF NOT EXISTS tiles(zoom_level INTEGER,tile_column INTEGER,tile_row INTEGER,tile_data BLOB,PRIMARY KEY(zoom_level,tile_column,tile_row));')
 for z in range(8,14):
  n=1<<z
  # GTHA bounding box, keeping generation regional instead of global.
  west,north,east,south=-80.4,44.55,-78.3,43.05
  x0=max(0,int(proj(west,0,z)[0])-1); x1=min(n,int(proj(east,0,z)[0])+2)
  y0=max(0,int(proj(0,north,z)[1])-1); y1=min(n,int(proj(0,south,z)[1])+2)
  for x in range(x0,x1):
   for y in range(y0,y1):
    im=Image.new('RGB',(256,256),(242,240,233)); dr=ImageDraw.Draw(im)
    west,south,east,north=-95.2,41.5,-74.0,57.2
    lon0=west+(east-west)*x/n; lon1=west+(east-west)*(x+1)/n
    lat1=57.2-(57.2-41.5)*y/n; lat0=57.2-(57.2-41.5)*(y+1)/n
    for table,col,w in [('water',(167,205,224),2),('roads',(93,91,85),2)]:
     for (raw,) in db.execute(f'SELECT geometry FROM {table} WHERE maxlon>=? AND minlon<=? AND maxlat>=? AND minlat<=?',(lon0,lon1,lat0,lat1)):
      pts=[(int((proj(a,b,z)[0]-x)*256),int((proj(a,b,z)[1]-y)*256)) for a,b in json.loads(raw)]
      if len(pts)>1 and any(-256<=a<=512 and -256<=b<=512 for a,b in pts):dr.line(pts,fill=col,width=w)
    buf=io.BytesIO(); im.save(buf,format='PNG',optimize=True); out.execute('INSERT OR REPLACE INTO tiles VALUES (?,?,?,?)',(z,x,n-1-y,buf.getvalue()))
  out.commit()
 db.close();out.close()
if len(sys.argv)!=3:raise SystemExit('usage: render_mbtiles.py data/places.sqlite3 data/ontario.mbtiles')
main(sys.argv[1],sys.argv[2])
