FROM node:24.19.0-bookworm-slim AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=1024
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG SOURCE_COMMIT
ENV SOURCE_COMMIT=$SOURCE_COMMIT
RUN npm run build
FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 NODE_OPTIONS=--max-old-space-size=128
COPY --from=builder --chown=node:node /app/dist/client ./dist/client
COPY --chown=node:node server ./server
COPY --chown=node:node status ./status
COPY --chown=node:node history ./history
COPY --chown=node:node realtime ./realtime
RUN mkdir -p /data/history && chown node:node /data/history
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/web.mjs"]
