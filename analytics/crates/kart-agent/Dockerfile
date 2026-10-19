# Build context: analytics/ (needs schema/)
#   docker build -f crates/kart-agent/Dockerfile .
# Development only (compose profile "sero"). On the kart, the agent is a systemd
# service from the headunit package.

FROM rust:1.99-slim-trixie AS build
# sero-sys compiles a C++ shim.
RUN apt-get update && apt-get install -y --no-install-recommends g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --release --locked -p kart-agent \
    && cp target/release/kart-agent /usr/local/bin/kart-agent

FROM debian:trixie-slim
COPY --from=build /usr/local/bin/kart-agent /usr/local/bin/kart-agent
# What systemd's StateDirectory=/RuntimeDirectory=/ConfigurationDirectory= provide on the kart.
RUN mkdir -p /data/state /data/run /data/etc && chown -R nobody /data
ENV STATE_DIRECTORY=/data/state RUNTIME_DIRECTORY=/data/run CONFIGURATION_DIRECTORY=/data/etc
USER nobody
ENTRYPOINT ["kart-agent"]
