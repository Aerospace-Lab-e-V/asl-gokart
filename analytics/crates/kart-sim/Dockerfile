# Build context: analytics/ (needs schema/)
#   docker build -f crates/kart-sim/Dockerfile .

FROM rust:1.99-slim-trixie AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --release --locked -p kart-sim \
    && cp target/release/kart-sim /usr/local/bin/kart-sim

FROM debian:trixie-slim
COPY --from=build /usr/local/bin/kart-sim /usr/local/bin/kart-sim
USER nobody
ENTRYPOINT ["kart-sim"]
