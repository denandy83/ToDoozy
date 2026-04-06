# ── Stage 1: Build ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Build frontend (Vite) and server (TypeScript)
RUN npm run build
RUN npx tsc -p tsconfig.server.json

# ── Stage 2: Production ────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Only install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

EXPOSE 3100

ENV NODE_ENV=production
ENV PORT=3100

CMD ["node", "dist-server/index.js"]
