FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g turbo

# ─── Prune stage ─────────────────────────────────────────────────────────────
FROM base AS pruner
COPY . .
RUN turbo prune --scope=@job-scheduler/api --docker

# ─── Dependencies stage ───────────────────────────────────────────────────────
FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/package-lock.json ./package-lock.json
RUN npm ci

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM deps AS builder
COPY --from=pruner /app/out/full/ .
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=backend/shared
RUN npm run build --workspace=backend/api

# ─── Production image ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/backend/shared/dist ./backend/shared/dist
COPY --from=builder /app/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /app/backend/api/dist ./backend/api/dist
COPY --from=builder /app/backend/api/package.json ./backend/api/package.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "backend/api/dist/index.js"]
