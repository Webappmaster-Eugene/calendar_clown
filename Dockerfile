# Stage 1: Build backend
FROM node:20-slim AS backend-builder

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY .git ./.git
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.* ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build

# Stage 2: Build webapp (Mini App)
FROM node:20-slim AS frontend-builder

WORKDIR /app/webapp
COPY webapp/package.json webapp/package-lock.json ./
RUN npm ci
COPY webapp/ ./
# Shared types needed for webapp build (path alias @shared → ../src/shared)
COPY src/shared /app/src/shared
RUN npm run build

# Stage 3: Runtime
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend-builder /app/dist ./dist
COPY --from=backend-builder /app/src/db/migrations ./migrations
COPY --from=frontend-builder /app/webapp/dist ./webapp-dist
COPY drizzle ./drizzle

RUN mkdir -p data/tokens data/voice

ENV MIGRATIONS_DIR=/app/migrations
ENV DRIZZLE_DIR=/app/drizzle

EXPOSE 18790

CMD ["node", "dist/index.js"]
