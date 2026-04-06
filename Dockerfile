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
RUN pnpm --filter @bill-alarm/server db:generate && pnpm --filter @bill-alarm/server build
# Install production-only deps in a separate directory
RUN pnpm --filter @bill-alarm/server deploy /app/deployed --prod --legacy
# Remove workspace package (already bundled by tsup)
RUN rm -rf /app/deployed/node_modules/@bill-alarm

# Stage 4: Production
FROM node:22-alpine
WORKDIR /app

COPY --from=server-builder /app/apps/server/dist ./
COPY --from=server-builder /app/apps/server/generated ./generated
COPY --from=server-builder /app/deployed/node_modules ./node_modules
COPY --from=server-builder /app/apps/server/prisma/ ./prisma/
COPY --from=server-builder /app/apps/server/prisma.config.ts ./prisma.config.ts
COPY --from=web-builder /app/apps/web/.output/public ./public

ENV NODE_ENV=production
ENV DATABASE_URL=file:./data/bill-alarm.db

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node serve.js"]
