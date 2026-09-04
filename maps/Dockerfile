FROM python:3.12-slim
WORKDIR /srv
COPY server.py import_places.py /srv/maps/
VOLUME ["/srv/maps/data"]
EXPOSE 8787
CMD ["python", "/srv/maps/server.py"]
