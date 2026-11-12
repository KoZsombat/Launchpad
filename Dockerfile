# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @launchpad/server build \
 && pnpm --filter @launchpad/web build \
 && pnpm --filter @launchpad/server deploy --prod /prod/server

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates openssh-client \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /prod/server ./
COPY --from=build /app/apps/web/dist ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
