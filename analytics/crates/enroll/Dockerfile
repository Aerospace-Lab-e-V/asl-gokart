# Build context: analytics/
#   docker build -f crates/enroll/Dockerfile .

FROM rust:1.99-slim-trixie AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/src/target,sharing=locked \
    cargo build --release --locked -p enroll \
    && cp target/release/enroll /usr/local/bin/enroll

FROM debian:trixie-slim
# Fixed uid: the device CA directory on the host (/etc/kart-analytics/device-ca) is owned
# by it, see deploy/vm/README.md.
RUN groupadd --system --gid 10082 enroll \
    && useradd --system --uid 10082 --gid 10082 --no-create-home --shell /usr/sbin/nologin enroll \
    && install -d -o enroll -g enroll -m 700 /data /device-ca
COPY --from=build /usr/local/bin/enroll /usr/local/bin/enroll
USER enroll
ENTRYPOINT ["enroll"]
CMD ["serve"]
