# Deploying mdbook

The container image is **generic** — no content is baked in. A site is a directory
mounted at `/site`, so one image serves every installation, upgrading mdbook is a
tag bump, and rollback is pointing the volume at a previous build.

## Container

```bash
docker pull ghcr.io/helex-solutions/mdbook:latest
docker run -d --name docs --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v /srv/docs/mysite:/site \
  ghcr.io/helex-solutions/mdbook:latest
```

The image is public, so the pull needs no registry login. Build locally
(`docker build -t mdbook:dev .`) only to run a change that has not been published
— see [Publishing the image](#publishing-the-image).

| Variable | Default | Meaning |
|---|---|---|
| `MDBOOK_PROJECT` | `/site` | project root inside the container |
| `MDBOOK_PORT` | `8080` | listen port |
| `MDBOOK_BUILD` | *(unset)* | `1` builds the mounted project on start |

`serve` needs a built site. Either build in CI and mount the result — the mount can
then be `:ro`, and the container writes nothing outside `/tmp` — or set
`MDBOOK_BUILD=1`, in which case **the volume must be writable by uid 10001**
(`chown -R 10001:10001 <dir>`), because the image runs unprivileged.

`MDBOOK_BUILD=1` rebuilds on **every** start, which on a large site turns each
restart into a multi-minute outage — a site of a few thousand pages that also
fetches OpenAPI documents at build time takes close to ten minutes. Past a demo, build
once and leave the variable unset. Any argument runs that mdbook command instead
of serving:

```bash
docker run --rm -v /srv/docs/mysite:/site ghcr.io/helex-solutions/mdbook:latest build
```

Auth configuration is read from config or the environment (`AUTH_OIDC_AUTHORITY`,
`AUTH_OIDC_CLIENT_ID`, `AUTH_SESSION_SECRET`, …) — see [`auth-design.md`](auth-design.md)
for the model and [`keycloak.md`](keycloak.md) for provider setup. Keep
`AUTH_SESSION_SECRET` in an env file readable only by root (`chmod 600`), not in the
compose file.

## Upgrading

```bash
docker pull ghcr.io/helex-solutions/mdbook:latest
docker rm -f docs
docker run -d --name docs --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -v /srv/docs/mysite:/site \
  ghcr.io/helex-solutions/mdbook:latest
```

**`docker restart` will not do it.** A container stays bound to the image *ID* it
was created from, so pulling a newer `:latest` leaves it running the old code —
and it lies convincingly while doing so: `docker inspect --format '{{.Config.Image}}'`
still prints the tag you pulled, because that field records the name the container
was created with, not what the tag points at now. The container has to be replaced.

To check what is actually running rather than what is labelled:

```bash
docker exec docs ls /opt/mdbook/src/auth/    # or any file the new version changed
```

A **content** update is different and needs no restart at all — `serve` reads files
per request. Only a new `acl.json` (access rules changed) or a new image requires
one.

## nginx

Terminate TLS in front and proxy the path through unchanged. When the site lives
under a path, `site.base` must match it (`base: /mdbook/`), because the generator
writes that prefix into every generated URL:

```nginx
location = /mdbook {
    return 301 https://$host/mdbook/;
}

location /mdbook/ {
    proxy_pass http://127.0.0.1:8510;      # no trailing slash: path passes through
    proxy_http_version 1.1;

    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host  $http_host;

    # Compression. `serve` sends every file uncompressed, so whatever the proxy
    # does is what readers get — and nginx's defaults do nothing here twice over:
    # `gzip_proxied` is `off`, so no proxied response is compressed at all, and
    # the default `gzip_types` is `text/html` alone, so JavaScript is skipped even
    # once it is on. Both lines are needed, and belong in this location rather
    # than the `http` block, where they would change every other vhost too.
    gzip_proxied any;
    gzip_types application/javascript text/javascript application/json text/css image/svg+xml;
    gzip_comp_level 6;
    gzip_vary on;
    gzip_min_length 1024;
}
```

`serve` derives its own public origin from `X-Forwarded-Proto`/`X-Forwarded-Host`
(used for OIDC redirect URIs), so pass both; `auth.publicUrl` overrides them when a
proxy cannot send them.

**Compression is not optional on a large site.** The local search index ships as a
single JavaScript chunk, and every reader downloads all of it the first time they
open search. On a 2 200-page site that chunk is ~29 MB, which gzip takes to
~7 MB — measured, on `docs.helex.org/emr`: 30,007,923 bytes transferred before,
7,508,680 after, and first-search load time from 3.4 s to 1.6 s. The chunk is
served from `/assets/` with `Cache-Control: immutable`, so it is one download per
reader per build, but that is still the download that decides whether search feels
usable. A gated site makes this bite harder than a public one: until v1.6.0 a
wholly gated site indexed nothing, so the chunk was a couple of hundred bytes and
compression never mattered.

## Publishing the image

`ghcr.io/helex-solutions/mdbook` comes from the **Docker image** workflow, which runs
only on demand — Actions → *Docker image* → *Run workflow*, dispatched from the ref you
want built (a release tag, normally):

| Input | Default | Meaning |
|---|---|---|
| `tag` | *(empty)* | image tag; empty derives one from the ref — `v1.5.0` → `1.5.0`, a branch → `<branch>-<short sha>` |
| `latest` | off | also publish `:latest`, which is what the untagged pull above resolves to |
| `push` | on | untick to build and smoke-test without touching the registry |
| `platforms` | `linux/amd64` | add `linux/arm64` for Apple-silicon hosts; it is emulated, so it roughly doubles the build |

Every run builds the image and serves [`demo/`](../demo) from it before pushing, so a
broken entry point or a missing `COPY` fails the run rather than the registry.

## Publishing from CI

The GitHub Action can rsync the built site to the server after a build:

```yaml
- uses: helex-solutions/mdbook@v1.5.0
  with:
    project: .
    deploy-target: deploy@docs.example.org:/srv/docs/mysite
    deploy-key: ${{ secrets.DOCS_DEPLOY_KEY }}
    deploy-post: docker restart docs        # only needed when acl.json/config changed
```

A content-only update needs no restart: `serve` reads files per request.

## Reference deployments

Two live installations, deliberately different shapes.

**`https://tx.helex.dev/mdbook/`** — the [`demo/`](../demo) project. Content in
`/root/mdbook/site` (owned by uid 10001), container `mdbook-demo` on
`127.0.0.1:8510` with `--env-file /root/mdbook/mdbook.env`, and the nginx location
above in `tx.conf`. It authenticates against the `mdbook` realm on
`https://sso.helex.dev` (client `owlexicon`, see [`keycloak.md`](keycloak.md)):
**the site is public**, `internal/**` requires `editor` or `admin`.

**`https://docs.helex.org/emr/`** — the EMR documentation, ~2200 pages and 32
OpenAPI documents, mounted under a path on a host that also serves a static landing
page at `/`. It pulls the published image rather than building one, and the site is
built once per deploy (`docker run --rm … build`) rather than with `MDBOOK_BUILD=1`,
because a rebuild takes minutes. Container `docs-emr` on `127.0.0.1:8520`, project in
`/root/docs/emr/site`, `site.base: /emr/`.

It authenticates against the `docs-emr` realm, and **the whole site is role-gated**
(`access: [viewer]`) — the case worth understanding before choosing it:

- Signing in is not enough. A federated (Google) user authenticates and still gets
  403 until someone puts them in the `mdbook-viewer` group. That group membership is
  the invitation; plan for it, or set a default role.
- Everything not explicitly public inherits the role — including `/assets/`, the
  theme bundle. That is why the 403 and signed-out pages are rendered by `serve`
  rather than built (see [`auth-design.md`](auth-design.md)); it is handled, but it
  is the reason a wholly gated site behaves differently from a mostly public one.
- `site.base` in config wins over `MDBOOK_BASE`, so a site whose repo says `base: /`
  cannot be moved under a path by environment alone — the config has to say `/emr/`.

Note both hosts run the **snap** Docker package, which cannot read build contexts or
bind-mount paths outside `$HOME` — hence `/root/...` rather than `/opt` or `/srv`.
