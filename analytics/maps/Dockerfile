# Offline map packs for the headunit: renders every area in areas.yaml when the image is built
# (Settings → Offline maps on the headunit downloads them) and serves them; pit-wall proxies /maps here.
#   docker build -f Dockerfile .            (context: analytics/maps)
# Rebuild to pick up new areas or fresh OpenStreetMap data.

# Chromium with the system libraries Playwright needs; the version matches render/'s playwright-core.
FROM mcr.microsoft.com/playwright:v1.64.1-noble AS render
COPY --from=docker.io/oven/bun:1.4.3 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /src/render
COPY render/package.json render/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY render/src ./src
COPY areas.yaml /src/areas.yaml
RUN bun src/render.ts

FROM docker.io/library/caddy:2.11.7-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=render /src/out /srv/maps
EXPOSE 8080
