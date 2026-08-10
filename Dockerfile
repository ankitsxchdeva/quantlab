# API server for the home box. The UI it pairs with is a static export served
# from GitHub Pages, so in practice this image exists to serve /api/*.
#
# Built for linux/arm64 (Raspberry Pi). Multi-stage so the runtime layer does
# not carry the toolchain.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Baked into the client bundle at build time. The Docker build serves its own
# UI same-origin, so this stays empty here.
ENV NEXT_PUBLIC_API_BASE=""
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Next's standalone server binds localhost by default, which is unreachable
# from outside the container.
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `output: "standalone"` emits a minimal server plus only the node_modules it
# actually traced. Static assets are not included in it and must be copied.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# No shell, no curl in the runtime image; node is the only interpreter present.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/arb',{method:'OPTIONS'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
