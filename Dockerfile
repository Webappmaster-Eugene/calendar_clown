FROM node:20-slim AS builder

ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=""

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsup.config.* ./
COPY scripts ./scripts
COPY src ./src

ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_DATE=${BUILD_DATE}
RUN npm run build

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/migrations ./migrations
COPY drizzle ./drizzle

RUN mkdir -p data/tokens data/voice

ENV MIGRATIONS_DIR=/app/migrations
ENV DRIZZLE_DIR=/app/drizzle

EXPOSE 18790

CMD ["node", "dist/index.js"]
