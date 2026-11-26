# Deploy bundle: everything the production host needs besides the app images (compose
# files, broker config, Grafana provisioning, the updater itself). The updater on the
# LXC extracts /bundle into /opt/kart-analytics/releases/<version>; the layout matches
# analytics/, so the relative bind mounts in compose.yml keep working.
# Build context: analytics/ (ignore rules: bundle.Dockerfile.dockerignore)
#   docker build -f deploy/bundle.Dockerfile .

FROM scratch
COPY deploy/compose /bundle/deploy/compose
COPY deploy/mosquitto /bundle/deploy/mosquitto
COPY deploy/lxc /bundle/deploy/lxc
COPY grafana /bundle/grafana
