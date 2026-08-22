FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g turbo

FROM base AS pruner
COPY . .
RUN turbo prune --scope=@job-scheduler/scheduler --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/package-lock.json ./package-lock.json
RUN npm ci

FROM deps AS builder
COPY --from=pruner /app/out/full/ .
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=backend/shared
RUN npm run build --workspace=backend/scheduler

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/backend/shared/dist ./backend/shared/dist
COPY --from=builder /app/backend/shared/package.json ./backend/shared/package.json
COPY --from=builder /app/backend/scheduler/dist ./backend/scheduler/dist
COPY --from=builder /app/backend/scheduler/package.json ./backend/scheduler/package.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

CMD ["node", "backend/scheduler/dist/index.js"]
