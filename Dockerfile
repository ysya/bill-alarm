# Stage 1: Install dependencies
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/server/prisma.config.ts apps/server/
COPY apps/server/prisma/ apps/server/prisma/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# Stage 2: Build web (static)
FROM deps AS web-builder
COPY . .
RUN pnpm --filter @bill-alarm/web generate

# Stage 3: Build server
FROM deps AS server-builder
COPY . .
RUN pnpm --filter @bill-alarm/server build

# Stage 4: Production (install prod deps natively on Alpine)
FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/server/prisma.config.ts apps/server/prisma.config.ts
COPY --from=server-builder /app/apps/server/prisma/ ./apps/server/prisma/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod && apk del python3 make g++
# Copy built artifacts
COPY --from=server-builder /app/apps/server/dist ./apps/server/
COPY --from=server-builder /app/apps/server/generated ./apps/server/generated
COPY --from=web-builder /app/apps/web/.output/public ./apps/server/public

ENV NODE_ENV=production
ENV DATABASE_URL=file:./data/bill-alarm.db

WORKDIR /app/apps/server

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node serve.js"]
