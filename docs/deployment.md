# Deploying mdbook

The container image is **generic** — no content is baked in. A site is a directory
mounted at `/site`, so one image serves every installation, upgrading mdbook is a
tag bump, and rollback is pointing the volume at a previous build.

## Container

```bash
docker build -t mdbook:latest .          # or pull a published tag
docker run -d --name docs --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -v /srv/docs/mysite:/site \
  mdbook:latest
```

| Variable | Default | Meaning |
|---|---|---|
| `MDBOOK_PROJECT` | `/site` | project root inside the container |
| `MDBOOK_PORT` | `8080` | listen port |
| `MDBOOK_BUILD` | *(unset)* | `1` builds the mounted project on start |

`serve` needs a built site. Either build in CI and mount the result — the mount can
then be `:ro`, and the container writes nothing outside `/tmp` — or set
`MDBOOK_BUILD=1`, in which case **the volume must be writable by uid 10001**
(`chown -R 10001:10001 <dir>`), because the image runs unprivileged.

Any argument runs that mdbook command instead of serving:

```bash
docker run --rm -v /srv/docs/mysite:/site mdbook:latest build
```

Auth configuration is read from config or the environment (`AUTH_OIDC_AUTHORITY`,
`AUTH_OIDC_CLIENT_ID`, `AUTH_SESSION_SECRET`, …) — see
[`auth-design.md`](auth-design.md).

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
}
```

`serve` derives its own public origin from `X-Forwarded-Proto`/`X-Forwarded-Host`
(used for OIDC redirect URIs), so pass both; `auth.publicUrl` overrides them when a
proxy cannot send them.

## Publishing from CI

The GitHub Action can rsync the built site to the server after a build:

```yaml
- uses: helex-solutions/mdbook@v1
  with:
    project: .
    deploy-target: deploy@docs.example.org:/srv/docs/mysite
    deploy-key: ${{ secrets.DOCS_DEPLOY_KEY }}
    deploy-post: docker restart docs        # only needed when acl.json/config changed
```

A content-only update needs no restart: `serve` reads files per request.

## Reference deployment

`https://tx.helex.dev/mdbook/` runs the [`demo/`](../demo) project this way — image
built on the host, content in `/root/mdbook/site`, container on `127.0.0.1:8510`,
nginx location as above. Note that host's Docker is the **snap** package, which
cannot read build contexts or bind-mount paths outside `$HOME` — hence `/root/...`
rather than `/opt` or `/srv`.
