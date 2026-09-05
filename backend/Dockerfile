FROM node:22-alpine
WORKDIR /app
COPY backend/package.json ./package.json
COPY backend/*.mjs backend/config.json ./
COPY backend/start.sh ./start.sh
COPY data/stops.json /data/stops.json
COPY data/routes.json /data/routes.json
COPY data/route-patterns.json /data/route-patterns.json
COPY data/transit-washrooms.json /data/transit-washrooms.json
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["sh", "start.sh"]
