# Build stage
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json bun.lock* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Runtime stage
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=20137
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 20137
USER node
CMD ["node", "dist/server.js"]
