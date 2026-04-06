# Stage 1: Install dependencies and build
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/server/prisma.config.ts apps/server/
COPY apps/server/prisma/ apps/server/prisma/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @bill-alarm/web generate
RUN pnpm --filter @bill-alarm/server build

# Stage 2: Production
FROM node:22-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
# Copy package manifests and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/server/prisma.config.ts apps/server/prisma.config.ts
COPY --from=builder /app/apps/server/prisma/ ./apps/server/prisma/
COPY packages/shared/package.json packages/shared/
# Install production deps natively on this platform
RUN pnpm install --frozen-lockfile --prod
# Copy built artifacts
COPY --from=builder /app/apps/server/dist ./apps/server/
COPY --from=builder /app/apps/server/generated ./apps/server/generated
COPY --from=builder /app/apps/server/prisma/ ./apps/server/prisma/
COPY --from=builder /app/apps/web/.output/public ./public

ENV NODE_ENV=production
ENV DATABASE_URL=file:./data/bill-alarm.db

WORKDIR /app/apps/server

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node serve.js"]
