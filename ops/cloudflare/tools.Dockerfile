FROM docker:27-cli AS docker

FROM node:22-bookworm
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
RUN apt-get -qq update >/dev/null && apt-get -qq install -y jq >/dev/null && rm -rf /var/lib/apt/lists/*
