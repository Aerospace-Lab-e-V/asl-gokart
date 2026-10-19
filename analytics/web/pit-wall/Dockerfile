# Build context: analytics/ (needs schema/ for code generation)
#   docker build -f web/pit-wall/Dockerfile .
# Ignore rules: Dockerfile.dockerignore next to this file (the shared .dockerignore
# excludes web/ for the Rust images).

FROM oven/bun:1.4.3-alpine AS build
WORKDIR /src/web/pit-wall
COPY web/pit-wall/package.json web/pit-wall/bun.lock ./
RUN bun install --frozen-lockfile
COPY schema /src/schema
COPY web/pit-wall ./
RUN bun run build

# Static SPA + reverse proxy: /api → pit-api, /mqtt → Mosquitto WebSocket listener.
FROM caddy:2.11.7-alpine
COPY web/pit-wall/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/web/pit-wall/dist /srv
EXPOSE 8080
