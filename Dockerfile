# Stage 1: Install dependencies, run security audit, and build Next.js standalone bundle
FROM node:20-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/next.config.ts web/postcss.config.mjs web/tsconfig.json ./
COPY web/public ./public
COPY web/src ./src
COPY web/tests ./tests

RUN npm test && npm run build

# Stage 2: Minimal non-root sleep-friendly production runtime (Render / Railway / Cloud Run)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=10000

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 10000

CMD ["node", "server.js"]
