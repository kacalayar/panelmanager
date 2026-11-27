FROM node:22-bookworm-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git docker.io \
  && curl -sSL https://nixpacks.com/install.sh | bash \
  && rm -rf /var/lib/apt/lists/*

FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY packages/docker/package.json packages/docker/
COPY packages/templates/package.json packages/templates/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --no-frozen-lockfile

COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

COPY --from=builder /app ./
COPY --from=builder /app/apps/web/.next/static /app/apps/web/.next/standalone/apps/web/.next/static
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh

VOLUME ["/data"]
EXPOSE 3000 3001

CMD ["/start.sh"]
