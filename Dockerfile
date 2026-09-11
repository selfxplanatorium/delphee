# ---- build ----
FROM node:22-alpine AS build

WORKDIR /app

# Install deps from package.json. package-lock.json is intentionally not tracked;
# npm regenerates it inside the image during the build.
COPY package.json ./
RUN npm install

# Copy the rest of the source.
COPY tsconfig.json ./
COPY src ./src

# Type-check + emit dist/. `tsc` doesn't move the static SPA assets, so the
# build script also copies them into dist/server/static. We invoke it directly
# (instead of duplicating the asset list here) so a new asset can never be
# served in dev but 404 in the image again.
RUN npm run build

# Prune dev dependencies to slim the prod node_modules.
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine

RUN apk add --no-cache tini \
 && addgroup -S app && adduser -S app -G app

WORKDIR /app

# Production deps + compiled output.
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json

USER app

# No volume, no data dir: all cache + session state is RAM-only (no PII at rest).
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# tini reaps zombies and forwards signals. CMD is the production start
# script (compiled JS, no tsx).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
