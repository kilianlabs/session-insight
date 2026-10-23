FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime
WORKDIR /app
LABEL org.opencontainers.image.title="Session Insight" \
  org.opencontainers.image.description="Session location and device enrichment" \
  org.opencontainers.image.source="https://github.com/kilianlabs/session-insight" \
  org.opencontainers.image.url="https://github.com/kilianlabs/session-insight" \
  org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV GEOIP_DATABASE_DIR=/data/geoip
RUN mkdir -p /data/geoip && chown node:node /data/geoip
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node LICENSE NOTICE ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=150s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]
