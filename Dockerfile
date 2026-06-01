# Build stage
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json bun.lock* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=20137
# Build tools for native modules (better-sqlite3). Most installs hit prebuilt
# binaries; these are only used as a fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates gosu \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 20137
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
