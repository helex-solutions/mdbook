# Authentication — design

Status: **implemented** — config, build-time ACL + `acl.json`, `mdbook serve` with verify and
trust-proxy modes, theme widget, Action deploy target, multi-space portal ingest
(`source.spaces`). Still tracked: silent session renewal, title-leak-free menus. This document specifies the `auth:`
capability: gating a built site behind OpenID Connect (Keycloak being the primary target) with
per-section rules and per-page overrides. The wider architecture — how this fits the Owlexicon wiki, the Helex suite
and the `wiki-ssg` export — lives in the helex-tx spec series (`OWLEXICON.01`); this document is
the mdbook-level contract the implementation follows.

## Goals and non-goals

**Goals**

- Real, server-side enforcement: an unauthorized visitor never receives a protected page's HTML,
  its images, or its text via the search index.
- Per-section access rules plus per-page frontmatter overrides (Confluence-style restrictions).
- Helex/Keycloak SSO: pointing `auth.issuer` at the same realm an existing app uses means a user
  signed in there reaches the docs without a second login (the IdP's SSO cookie completes the
  redirect silently).
- A site with no `auth:` block builds and behaves exactly as today.

**Non-goals**

- **GitHub Pages (or any dumb static host) cannot enforce anything.** Client-side gating on such
  a host is cosmetic — the files are world-readable. A gated site's production entry point is
  `mdbook serve` (below), behind a TLS-terminating reverse proxy.
- No privilege vocabulary. The site checks **role names** from the token; mapping organizational
  privileges to roles is the identity provider's (or the authoring system's) job.
- No user management, no self-registration, no session UI beyond sign-in/out.

## Config

```yaml
# .mdbook/config.yml
auth:
  issuer: https://sso.example.org/realms/htx
  clientId: owlexicon
  # clientSecret: ${AUTH_OIDC_CLIENT_SECRET}  # optional — confidential client; env-resolved
  scopes: [openid, profile]
  roleClaims: roles                       # dotted paths, comma-separated fallbacks
                                          # e.g. "realm_access.roles,resource_access.owlexicon.roles"
  access: public                          # site default: public | authenticated | [role, …]
  rules:                                  # per-section rules; longest path match wins
    - path: internal/**
      access: [editor, admin]
    - path: handbook/**
      access: [wiki-handbook, admin]
  session:
    secret: ${AUTH_SESSION_SECRET}        # cookie-signing key; env-resolved
    maxAge: 8h
  # Alternative to issuer verification — trust an authenticating gateway instead (see below):
  # trustProxy:
  #   userHeader: X-Auth-Request-User
  #   rolesHeader: X-Auth-Request-Groups
  # Accept tokens from more than one IdP (verify mode):
  # issuers:
  #   public:   { issuer: https://idp-a.example.org }
  #   internal: { issuer: https://idp-b.example.org, jwksUrl: https://…/jwks, audience: docs }
```

Normalization follows the `normalizeOpenapi` pattern in `src/config.mjs` (dual
`clientId`/`client-id` naming, `enabled: false` kill switch, `${VAR}` resolved from the build/run
environment and never written into the site — the `openapi.specs.*.headers` precedent).
`openapi.auth` falls back to the top-level `auth` block, so the try-it console and the site gate
share one realm and client configured once.

Every key falls back to the environment variable its ecosystem already uses, so a container is
fully configured from env alone:

| Config key | Env fallback |
|---|---|
| `issuer` | `AUTH_OIDC_AUTHORITY` (also `OAUTH_ISSUER`) |
| `clientId` | `AUTH_OIDC_CLIENT_ID` (also `OAUTH_CLIENT_ID`) |
| `clientSecret` | `AUTH_OIDC_CLIENT_SECRET` |
| `scopes` | `AUTH_OIDC_SCOPE` (space-separated; also `OAUTH_SCOPE`) |
| `roleClaims` | `AUTH_ROLE_CLAIMS` |
| `access` | `GUEST_DISABLED=true` forces at least `authenticated` |
| `session.secret` | `AUTH_SESSION_SECRET` |

(`AUTH_OIDC_*` are the Helex runtime-config names; `OAUTH_*` and `AUTH_ROLE_CLAIMS`/`GUEST_DISABLED`
are the TermX ones. The `issuers` map mirrors the Helex backend's
`…auth.oidc.issuers.<name>.{issuer-uri, jwk-set-uri, audience}` semantics.)

Per-page override, in frontmatter:

```yaml
---
access: [admin]        # or: authenticated | public
---
```

Effective ACL = page frontmatter → longest-matching rule → site default. For `termx`-format
projects the same value can arrive per page node in `pages.json` (`access` field — an additive
extension of the wiki-ssg contract) and as site defaults in `space.json`'s `ssg.auth` block; the
repo's own config wins, as with every other `ssg` field.

## Build-time changes

The build stays static-host-compatible; auth adds metadata, it does not change page output:

1. **ACL resolution** — during staging (`stageContent`, `src/build.mjs`), compute each page's
   effective ACL and emit **`acl.json`** next to the dist:

   ```json
   {
     "default": "public",
     "rules": [ { "path": "internal/**", "access": ["editor", "admin"] } ],
     "pages": { "/internal/keys": ["admin"] },
     "assets": [ { "prefix": "/attachments/42/", "access": ["editor", "admin"] } ]
   }
   ```

   The `assets` block covers attachments belonging to protected termx pages (attachments are
   keyed by page id), so images embedded in a protected page inherit its ACL.
2. **Search exclusion** — every protected page gets `search: false` frontmatter (the existing
   lever, already used for redirect stubs and the OAuth callback page), so the VitePress local
   search chunk (`assets/chunks/@localSearchIndex*.js`) never contains protected text.
3. **Generated pages** — following the OAuth-callback-page pattern in `src/build.mjs`: a login
   landing page and a 403 page, both `search: false`.

### Leak model (v1)

Content, assets and search: never leak — enforced per request. Sidebar/nav **titles** of
protected pages are baked into the JS bundle and hidden client-side per session — a known,
accepted v1 leak (documented to users). Follow-ups that remove it: per-session menu delivery,
or fully separate per-audience builds.

## `mdbook serve`

A third CLI command beside `build` and `dev`: a small Node server (dependency: `jose`) that
serves the built dist and enforces `acl.json`. Deployed behind nginx (TLS); it is the production
entry point for any site with protected content.

### Verify mode (default)

- **Server-side Authorization Code + PKCE** against `auth.issuer` (discovery via
  `/.well-known/openid-configuration`). A `clientSecret` is honoured if configured (it never
  reaches a browser); PKCE alone is sufficient for a public client.
- Endpoints:
  - `GET /auth/login?returnTo=…` — starts the redirect;
  - `GET /auth/callback` — server-side code exchange; sets the session; redirects to `returnTo`;
  - `GET /auth/logout` — drops the session, RP-initiated logout via `end_session_endpoint`;
  - `GET /auth/session` — `{ user, roles }` JSON for the theme; `401` when anonymous.
- Session: **signed HttpOnly cookie** carrying subject, display name, roles, expiry. No token in
  browser storage, and no `?token=` query parameters on asset URLs — the cookie is what lets a
  plain `<img>` load a protected attachment.
- Session lifetime is fixed in v1 (expiry re-runs the redirect, invisible while the IdP's SSO
  session is alive). **Silent renewal is designed-for, post-v1**: the code exchange is
  server-side, so `serve` can keep the refresh token and extend sessions sliding-window-style —
  server state only, no cookie-format or endpoint change.
- Per request: route → `acl.json` → serve | `302` to `/auth/login` (anonymous) | `403` page
  (authenticated, missing role).
- Multi-issuer: `auth.issuers` maps issuer → JWKS; keys selected by issuer + `kid`, JWKS cached
  per issuer, failed fetches never cached.
- Access log includes the username and the ACL decision — the attachment point for
  deployment-side audit forwarding.

### Trust-proxy mode

For deployments where a gateway already authenticates (oauth2-proxy, Cloudflare Access, nginx
`auth_request`): `auth.trustProxy` names the identity/roles headers and `serve` skips
verification. Mutually exclusive with verify mode, and safe **only** when `serve` is unreachable
except through the gateway. (This mirrors the verify-vs-trust split in the Helex backend:
`tedy.auth.oidc.*` vs `tedy.auth.jwt.enabled`.)

## Theme

A new `src/theme/auth.mjs`, registered in `src/theme/index.mjs` and configured through the same
config → bundle → `themeConfig` path as `openapi`:

- fetches `/auth/session`; renders sign-in/sign-out and a user badge in the nav bar;
- hides sidebar/nav entries the session's roles cannot access (cosmetic layer over server
  enforcement, never instead of it);
- after login, returns the reader to the page they originally requested.

The OpenAPI try-it console keeps its own in-browser PKCE flow (`src/theme/oidc.mjs`) — it needs a
real access token for cross-origin API calls; it simply inherits issuer/client from the shared
config.

## Deployment recipes

- **Linux server, published from the build (the primary target)** — CI builds the site and ships
  the dist + `acl.json` to an own Linux server over SSH (rsync), where a **systemd-managed
  `mdbook serve`** runs behind nginx. The GitHub Action grows a deploy target for this
  (host/path/key inputs), so a repo goes content-push → built → live on its own server with no
  third-party hosting in the path — explicitly replacing Cloudflare Pages + Access setups.
- **nginx + serve** — nginx terminates TLS and proxies to `mdbook serve` (same shape as the
  TermX quick-start nginx configs). The `serve` port must not be reachable directly.
- **Docker** — one image running `mdbook serve --project /site`; config via env
  (`AUTH_OIDC_AUTHORITY`, `AUTH_OIDC_CLIENT_ID`, `AUTH_SESSION_SECRET`, optionally
  `AUTH_OIDC_CLIENT_SECRET` — see the env table above).
- **Same-origin with a Helex suite** — mount the docs under a path of the suite origin and point
  `auth.issuer` at the suite's `AUTH_OIDC_AUTHORITY`; the Keycloak SSO cookie makes sign-in
  invisible for suite users.
- **Gateway-fronted** — oauth2-proxy or similar in front, `serve` in trust-proxy mode. The
  gateway alone is hostname-granular; per-section rules still come from `serve`.

When `auth:` is configured, `serve` **is** the deployment — there is no supported gated
deployment without it. Multi-space portals (several wiki spaces under one origin, Confluence
style) are first-class: `source.spaces` mounts each wiki-ssg export under its own section,
portal rules match mounted paths (`api/**`), a space's exported `ssg.auth` becomes rules scoped
to its mount, attachments are namespaced per mount — one `acl.json`, one `serve` process, one
login for the whole portal.

## Macro parity contract

mdbook's build-time renderers are the static half of the Owlexicon macro registry: diagrams
(`src/markdown/diagrams.mjs`), termx links (`src/markdown/termx-links.mjs`), structure
definitions (`src/ingest/structure-definition.mjs`), concept matrices
(`src/ingest/concept-matrix.mjs`), tabsets/collapsibles/cards, OpenAPI blocks. A macro added to
the wiki editor must either reduce to one of the canonical syntaxes in
[`termx-wiki-compatibility.md`](termx-wiki-compatibility.md) or land its static renderer here in
the same change — that compatibility matrix is the contract document between the two codebases.
