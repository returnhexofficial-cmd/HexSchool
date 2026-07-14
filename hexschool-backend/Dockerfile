# ── deps ────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

# ── development (used by docker-compose) ────────────────────────────
FROM node:22-alpine AS development
ENV TZ=UTC
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
CMD ["npm", "run", "start:dev"]

# ── build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

# ── production ──────────────────────────────────────────────────────
FROM node:22-alpine AS production
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
ARG BUILD_SHA=unknown
ARG BUILD_TIME=""
ENV BUILD_SHA=$BUILD_SHA BUILD_TIME=$BUILD_TIME
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
USER node
EXPOSE 4000
CMD ["node", "dist/main"]
