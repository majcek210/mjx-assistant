# ─── Stage 1: Production dependencies ────────────────────────────────────────
# Compiles native addons (better-sqlite3) in isolation so the runner
# stage doesn't need build tools at all.
FROM node:22-alpine AS deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force


# ─── Stage 2: TypeScript builder ─────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Compile TypeScript
RUN npm run build

# tsc does not copy JSON files — copy model definitions to where handler.ts
# expects them at runtime: dist/lib/ai/models/  (path.join(__dirname, "models"))
RUN cp -r src/lib/ai/models dist/lib/ai/models


# ─── Stage 3: Production runner ──────────────────────────────────────────────
FROM node:22-alpine AS runner

# libstdc++ is required to load the compiled better-sqlite3 native addon
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copy compiled production dependencies from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled application from the builder stage
COPY --from=builder /app/dist ./dist

# Runtime config (mainAgent, selectionStrategy, storage driver, etc.)
COPY config.json ./

# Persistent volume for the SQLite database (override DB_PATH to point elsewhere
# when using MySQL/MariaDB — this volume is a no-op in that case)
RUN mkdir -p data && chown -R node:node /app

VOLUME ["/app/data"]

ENV NODE_ENV=production \
    DB_PATH=data/db.sqlite

# Run as non-root for security
USER node

CMD ["node", "dist/main.js"]
