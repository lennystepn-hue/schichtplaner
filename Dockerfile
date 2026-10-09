FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Eigener Server (server.ts) statt des Standard-Starts von Next.js:
# nur so laeuft Socket.io und damit Echtzeit-Updates und Live-Modus.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/messages ./messages
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json /app/tsconfig.json /app/next.config.ts /app/server.ts ./

USER nextjs

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
