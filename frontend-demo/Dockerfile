# syntax=docker/dockerfile:1

# ---- 1. Install dependencies ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. Production build ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined at build time. Fix the HTTP pipeline for production
# and keep them identical at runtime (compose mirror) so client/server agree.
ENV NEXT_PUBLIC_ANALYSIS_REPOSITORY=http \
    NEXT_PUBLIC_ANALYSIS_API_BASE_URL=/api/v1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. Runtime ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
# SQLite data is provided at runtime via a mounted volume (see docker-compose.yml).
RUN mkdir -p /app/.greenlens-runtime
EXPOSE 3130
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3130"]