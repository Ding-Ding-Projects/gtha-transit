FROM python:3.12-slim
RUN pip install --no-cache-dir Pillow==10.4.0 pyosmium==4.1.1
WORKDIR /srv
COPY server.py import_places.py import_osm.py render_mbtiles.py /srv/maps/
VOLUME ["/srv/maps/data"]
EXPOSE 8787
CMD ["python", "/srv/maps/server.py"]
