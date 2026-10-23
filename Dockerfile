# syntax=docker/dockerfile:1
# One image, two roles:
#   web:     docker run IMAGE                          (Next.js standalone server)
#   worker:  docker run IMAGE node dist/worker.mjs     (background jobs)
#   migrate: docker run IMAGE node dist/migrate.mjs
#   admin:   docker run IMAGE node dist/create-admin.mjs you@example.com "Your Name"
# The worker and scripts are bundled into single files, so the image carries no node_modules of its own.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:server

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app

# Web server (standalone output)
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

# Worker, migrations and admin script: bundled files, plus the SQL migrations they apply.
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app drizzle ./drizzle

USER app
EXPOSE 3000
CMD ["node", "server.js"]
