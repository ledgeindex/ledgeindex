# ============================================================================
# BASE IMAGE
# ============================================================================
FROM node:22-bullseye-slim AS base


# ============================================================================
# STAGE 1: DEPENDENCIES
# ============================================================================
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund


# ============================================================================
# STAGE 2: BUILDER
# ============================================================================
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY .env.vault ./.env.vault
COPY . .

# IMPORTANT: DOTENV_KEY must be provided as build arg (Cloud Build substitution)
ARG DOTENV_KEY
ENV DOTENV_KEY=$DOTENV_KEY
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096

# Same as pindown frontend — preload dotenv before next build (NEXT_PUBLIC_* at build time)
RUN node -r dotenv/config node_modules/.bin/next build


# ============================================================================
# STAGE 3: RUNNER
# ============================================================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOST=0.0.0.0
ENV PORT=3004

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget \
  && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
RUN npm install dotenv --omit=dev --no-audit --no-fund

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/.env.vault ./.env.vault

USER nextjs

EXPOSE 3004

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3004/ || exit 1

CMD ["node", "-r", "dotenv/config", "server.js"]
