# Build context: analytics/ (needs schema/ and db/migrations/)
#   docker build -f crates/ingest/Dockerfile .

FROM rust:1.99-slim-trixie AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --release --locked -p ingest \
    && cp target/release/ingest /usr/local/bin/ingest

FROM debian:trixie-slim
COPY --from=build /usr/local/bin/ingest /usr/local/bin/ingest
USER nobody
ENTRYPOINT ["ingest"]
