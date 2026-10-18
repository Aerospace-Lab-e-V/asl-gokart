# Build context: analytics/ (needs the workspace, incl. schema/)
#   docker build -f crates/pit-api/Dockerfile .

FROM rust:1.99-slim-trixie AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --release --locked -p pit-api \
    && cp target/release/pit-api /usr/local/bin/pit-api

FROM debian:trixie-slim
COPY --from=build /usr/local/bin/pit-api /usr/local/bin/pit-api
USER nobody
ENTRYPOINT ["pit-api"]
