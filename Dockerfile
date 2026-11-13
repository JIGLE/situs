FROM node:26-alpine AS builder

ARG BUILD_VERSION
ARG GIT_COMMIT
ARG BUILD_TIME

ENV BUILD_VERSION=${BUILD_VERSION}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}

WORKDIR /app

# Install build dependencies required for native modules (better-sqlite3 used by ensure-sqlite.js)
RUN apk add --no-cache python3 make g++ pkgconfig

# Copy package files and prisma schema (needed for postinstall prisma generate)
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm install

# Cache bust AFTER npm install so dependency layers are reused across runs.
# Only application code rebuild is forced on every CI run.
ARG CACHE_BUST
RUN echo "Cache bust: ${CACHE_BUST}"

# Copy source code and build (invalidates on code changes only)
COPY next.config.ts tsconfig.json postcss.config.mjs eslint.config.js ./
COPY app ./app/
COPY components ./components/
COPY lib ./lib/
COPY types ./types/
COPY public ./public/
COPY proxy.ts ./
COPY messages ./messages/
COPY scripts ./scripts/
# `next build` type-checks everything tsconfig.json includes, which is `**/*.ts(x)` with only
# node_modules excluded. That sweeps in the 26 test files co-located under components/ and lib/,
# and those import `@/tests/helpers/*` — so without this the build fails with 26 TS2307s. The
# helpers are needed at type-check time only; the builder stage is discarded, and the runtime
# stage copies just public/, prisma/, scripts/, node_modules/ and .next/standalone, so no test
# code reaches the shipped image.
COPY tests ./tests/

# Provide dummy env vars required by the Zod env schema during build.
# These are NOT used at runtime — the real values come from the deployment environment.
#
# NEXT_BUILD=true is what tells lib/utils/env.ts this is a build rather than a booting server.
# `next build` sets NODE_ENV=production internally, so without this flag the production-only
# guards there (DATABASE_URL, and now PII_ENCRYPTION_KEY, which exits the process when absent)
# fire during the image build and fail it. CI gets the same effect for free from $CI, which is
# why this only bites on a plain `docker build`.
#
# No demo-login flag here any more: it is resolved per request on the server, so a build carries
# no baked-in demo state.
RUN NEXT_BUILD="true" \
    DATABASE_URL="file:./build.db" \
    NEXTAUTH_URL="http://localhost:3000" \
    NEXTAUTH_SECRET="build-time-placeholder-secret-minimum-32-chars" \
    GOOGLE_CLIENT_ID="build-placeholder" \
    GOOGLE_CLIENT_SECRET="build-placeholder" \
    npm run build

# Generate version.json
RUN echo "{\"version\":\"${BUILD_VERSION}\",\"git_commit\":\"${GIT_COMMIT}\",\"build_time\":\"${BUILD_TIME}\",\"node_env\":\"production\"}" > public/version.json

# ── Development stage (used by docker-compose --profile dev) ──────────────────
FROM node:26-alpine AS development

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ pkgconfig

# Copy package files and install all dependencies (including devDependencies)
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./
RUN npm install

# Source code is mounted via docker-compose volumes, not COPY'd

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=development

CMD ["npm", "run", "dev"]

# ── Production runner stage ───────────────────────────────────────────────────
FROM node:26-alpine AS runner

# OCI image labels — TrueNAS SCALE reads these for "App Version" / "Version" display
ARG BUILD_VERSION
ARG GIT_COMMIT
ARG BUILD_TIME
LABEL org.opencontainers.image.title="Situs" \
      org.opencontainers.image.description="Sovereign Capital System — property income, receipts and tax evidence" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      org.opencontainers.image.source="https://github.com/JIGLE/situs" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_TIME}" \
      org.opencontainers.image.vendor="JIGLE" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

VOLUME /app/data

ENV NODE_ENV=production

# The ARGs above reach the LABELs but NOT the running process: a multi-stage build does not
# inherit ENV from `builder`, where these are also set. Without these three lines /api/info
# reports version "dev" and commit "unknown" on a correctly built image, which is what it did
# while someone used it to check whether a deploy had landed.
ENV BUILD_VERSION=${BUILD_VERSION}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}

RUN addgroup -g 1001 -S nextjs
RUN adduser -u 1001 -S nextjs -G nextjs

COPY --from=builder /app/public ./public

# Copy prisma schema and node_modules from builder so runtime can run `npx prisma`/scripts that need the schema
COPY --from=builder --chown=nextjs:nextjs /app/prisma ./prisma
# Prisma 7 reads the database URL only from prisma.config.ts; without it every `prisma db push` and
# `migrate diff` that prestart runs fails. The standalone output happens to trace it today; this
# keeps it in the image when that tracing changes.
COPY --from=builder --chown=nextjs:nextjs /app/prisma.config.ts ./
COPY --from=builder --chown=nextjs:nextjs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nextjs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nextjs /app/package*.json ./

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Health check — lightweight /api/ready avoids DB dependency so
# TrueNAS SCALE (ix-app) and Docker Compose mark the container as
# "Running" even while the database is still being initialised.
# NOTE: Use GET (-O /dev/null) not --spider (HEAD) — Next.js auto-generated
# HEAD responses may not satisfy wget --spider's expectations.
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/api/ready || exit 1

CMD ["sh", "-c", "npm run prestart && node server.js"]
