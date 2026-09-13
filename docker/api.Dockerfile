# syntax=docker/dockerfile:1

FROM oven/bun:1-debian AS deps
WORKDIR /app
COPY package.json turbo.json tsconfig.base.json bun.loc[k]* ./
COPY packages/ packages/
COPY apps/ apps/
RUN bun install --frozen-lockfile

FROM node:22-slim AS prisma
WORKDIR /app
COPY --from=deps /app ./
RUN cd packages/db && npx prisma generate

FROM oven/bun:1-debian
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=prisma /app ./
RUN mkdir -p apps/api/public \
 && { bun run --filter web build && cp -r apps/web/dist/. apps/api/public/ ; } \
    || echo "web build unavailable - shipping empty apps/api/public"
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "apps/api/src/server.ts"]
