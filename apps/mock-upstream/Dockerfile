# syntax=docker/dockerfile:1

FROM oven/bun:1-debian AS deps
WORKDIR /app
COPY package.json turbo.json tsconfig.base.json bun.loc[k]* ./
COPY packages/ packages/
COPY apps/ apps/
RUN bun install --frozen-lockfile

FROM oven/bun:1-debian
WORKDIR /app
COPY --from=deps /app ./
ENV NODE_ENV=production
EXPOSE 4000
CMD ["bun", "run", "apps/mock-upstream/src/server.ts"]
