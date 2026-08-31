# Generic mdbook runtime image — content is NOT baked in.
#
# One image serves every installation: the project (its .mdbook/config.yml,
# content and built dist) arrives as a mounted volume at /site, so upgrading
# mdbook is a tag bump and publishing content is a volume write.
#
#   docker run -p 8080:8080 -v /srv/docs/mysite:/site ghcr.io/helex-solutions/mdbook
#
# `serve` needs a built site; MDBOOK_BUILD=1 builds on start (handy for a demo
# or a small site), otherwise build in CI and mount the result.
FROM node:22-alpine

# git: `npx github:…`-style installs and content repos mounted for a build.
RUN apk add --no-cache git tini

WORKDIR /opt/mdbook
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY src ./src

# A wrapper rather than a symlink: bin/mdbook.mjs is mode 644 in git, so the
# entry point must not depend on the execute bit surviving the copy.
RUN printf '#!/bin/sh\nexec node /opt/mdbook/bin/mdbook.mjs "$@"\n' > /usr/local/bin/mdbook \
    && chmod +x /usr/local/bin/mdbook \
    && addgroup -g 10001 mdbook \
    && adduser -u 10001 -G mdbook -s /bin/sh -D mdbook

# The project volume. A read-only mount works when the site is pre-built and
# MDBOOK_BUILD is unset — the container writes nothing outside /tmp then.
# With MDBOOK_BUILD=1 the volume must be writable by uid 10001 (the build
# writes .mdbook/dist and .mdbook/.cache), e.g. `chown -R 10001:10001 <dir>`.
VOLUME ["/site"]
ENV MDBOOK_PROJECT=/site \
    MDBOOK_PORT=8080 \
    MDBOOK_BUILD=""
EXPOSE 8080
USER mdbook

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
