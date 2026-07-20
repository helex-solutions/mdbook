---
description: "A Markdown + metadata static-site generator for tutorials, specifications and books. It turns TermX Wiki exports and GitBook repositories into a fast,…"
---

# mdbook

A Markdown + metadata static-site generator for tutorials, specifications and books.
It turns **TermX Wiki** exports and **GitBook** repositories into a fast, searchable,
themeable, multilingual website — and ships as a **GitHub Action**.

Built on [VitePress](https://vitepress.dev) (which uses `markdown-it`), so the TermX
Wiki "smart text" runs natively.

## Showcase

Real sites built with mdbook — click a thumbnail for the live site (see
[Reference projects](#reference-projects) for each one's `.mdbook/config.yml`):

<table>
<tr>
<td width="33%" valign="top"><a href="https://hl7.lt"><img src="docs/assets/mdbook-hl7lt.png" alt="HL7 Lithuania Registry built with mdbook"></a></td>
<td width="33%" valign="top"><a href="https://termx-health.github.io/tutorial/"><img src="docs/assets/mdbook-tutorial.png" alt="TermX tutorial built with mdbook"></a></td>
<td width="33%" valign="top"><a href="https://helex-solutions.github.io/ib-portfolio/"><img src="docs/assets/mdbook-portfolio.png" alt="Portfolio built with mdbook"></a></td>
</tr>
<tr>
<td align="center"><a href="https://hl7.lt"><b>HL7 Lithuania Registry</b></a><br><sub>National FHIR IG registry · <code>termx</code> source</sub></td>
<td align="center"><a href="https://termx-health.github.io/tutorial/"><b>TermX tutorial</b></a><br><sub>Docs with smart-text &amp; terminology · <code>termx</code> source</sub></td>
<td align="center"><a href="https://helex-solutions.github.io/ib-portfolio/"><b>Portfolio</b></a><br><sub>Personal site · <code>gitbook</code> source</sub></td>
</tr>
</table>

## Features

- 🔎 **Search** — built-in local full-text search (no external service)
- 🎨 **Skins** — swappable themes (`default`, `ocean`, `paper`, plus brand skins `helex`, `taltech`)
- 🧭 **Menu** — nav & sidebar auto-generated from your content; extendable or overridable in config. On a plain folder tree each top-level section gets its own sidebar, folders sort before files, and a page can set `sidebarTitle` to keep its menu label short
- 🧵 **Orientation at scale** — breadcrumbs above every page, and a **Related** block cross-linking the same document id across parallel trees (a spec ↔ its validation ↔ the story it traces from)
- 🌍 **Multilingual** — first-class locales (default language at `/`, others under `/<lang>/`)
- 🧩 **TermX smart-text** — callouts, tabsets, links-list/grid-list, `+++` collapsibles, `page:`/`cs:`/`vs:`/`concept:` links, `files/` images, page icons, GitBook card tables
- 📊 **Diagrams** — drawio, Mermaid, PlantUML
- 💻 **Code** — Shiki highlighting for every fenced block; a fence that cites a source file (```` ```43:58:src/Foo.java ````) is highlighted by the file's extension and captioned with the path
- 🌐 **OpenAPI** — render one or many OpenAPI 3.1 / 3.0 / Swagger 2.0 documents into searchable reference pages, from a whole document down to a single operation, with an optional try-it console authenticated via OpenID Connect (see [OpenAPI](#openapi))
- 🔗 **Terminology** — `{{def:}}` StructureDefinition viewer, and `{{csc:}}`/`{{vsc:}}` concept tables fetched from a FHIR server at build time
- 🏷️ **SEO** — per-page titles/descriptions, `sitemap.xml`, canonical + Open Graph/Twitter tags, JSON-LD and `robots.txt`. Descriptions, languages and site URL are read from the TermX export when authored (site URL also auto-detected in CI), with first-paragraph/CI inference as the fallback; page **tags** are emitted as `<meta name="keywords">`
- 💬 **Comments** — optional [Giscus](https://giscus.app) (GitHub Discussions) box per page (see [Comments](#comments-github-discussions))
- 🖥️ **Presentation mode** — a fullscreen, chrome-free view with prev/next controls for showing pages to an audience (see [Presentation mode](#presentation-mode))
- 🔍 **Zoom** — a −/+ control in the nav bar scales the article (80–200%, remembered per browser); pair it with `theme.wide` for dense reference tables

See [`docs/termx-wiki-compatibility.md`](docs/termx-wiki-compatibility.md) for the full
TermX Wiki → mdbook feature matrix.

## Quick start — a new project

1. **Add a `.mdbook/` config folder** to your content repo:

   ```yaml
   # .mdbook/config.yml
   site:
     title: My Docs
     lang: en
   source:
     format: gitbook          # gitbook | termx  (auto-detected if omitted)
   theme:
     skin: default            # default | ocean | paper | helex | taltech | hl7lt
   search: true
   ```

   Also add `.mdbook/.gitignore` with `.cache/` and `dist/`.

2. **Add a deploy workflow** `.github/workflows/mdbook.yml`:

   ```yaml
   name: Publish site
   on:
     push: { branches: [main] }
     workflow_dispatch:
   permissions: { contents: read, pages: write, id-token: write }
   concurrency: { group: pages, cancel-in-progress: true }
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - id: mdbook
           uses: helex-solutions/mdbook@v1.1.2   # pin to a release tag (see Versioning)
           with: { project: . }
         - uses: actions/configure-pages@v5
         - uses: actions/upload-pages-artifact@v3
           with: { path: $&#123;&#123; steps.mdbook.outputs.site &#125;&#125; }
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment: { name: github-pages, url: $&#123;&#123; steps.deployment.outputs.page_url &#125;&#125; }
       steps:
         - id: deployment
           uses: actions/deploy-pages@v4
   ```

3. **Enable GitHub Pages** → repo *Settings → Pages → Source: GitHub Actions*.
   (Pages on a **private** repo needs a paid plan; public repos work on the free plan.)

4. **Push to `main`.** The workflow builds and publishes to `https://<owner>.github.io/<repo>/`.

> **Base path is auto-detected** in CI: `/<repo>/` for a project page, or `/` for a
> custom domain (a `CNAME` file) or an `<owner>.github.io` user/org page. Override with
> `site.base:` in config, the `base:` action input, or `--base`. A `CNAME` in the project
> (root, `public/`, or `.gitbook/assets/`) is copied into the published site.

### Versioning

Pin the action to a **release tag** (e.g. `helex-solutions/mdbook@v1.1.2`) so your site builds are
deterministic — `main` can move without silently redeploying your site. See the
[releases](https://github.com/helex-solutions/mdbook/releases). Use `@main` only if you want the
latest, unreleased changes.

**To publish a new mdbook version:**

```bash
git tag -a v1.0.1 -m "…" && git push origin v1.0.1   # patch; v1.1.0 for features
```

Then bump `@v1.0.0` → `@v1.0.1` in each consumer's `.github/workflows/mdbook.yml` and push —
a deliberate step, so upgrades are reviewed rather than automatic.

## Local preview

```bash
npx github:helex-solutions/mdbook build --project .   # build to .mdbook/dist
npx github:helex-solutions/mdbook dev   --project .   # live-reload dev server
```

(`npx` clones the public repo and runs it; no npm publish needed. Requires Node ≥ 20.)

## Configuration reference — `.mdbook/config.yml`

```yaml
site:
  title: My Space              # falls back to space.json names / repo name
  description: One-line summary
  lang: en                     # default locale
  base: /                      # set to /repo/ for GitHub project pages
  url: https://example.org/    # optional canonical URL (auto-detected in CI);
                               #   enables sitemap.xml, canonical + Open Graph URLs
  logo: /.gitbook/assets/logo.png
  image: /.gitbook/assets/social.png  # optional Open Graph / social image (falls back to logo)
  web: https://example.org     # optional: base for cs:/vs:/page: web links

source:
  format: gitbook              # gitbook | termx  (auto-detected if omitted)
  exclude:                     # hide files/folders from BOTH the pages and the menu
    - CLAUDE.md                #   bare name -> matches at any depth
    - _templates               #   folder name -> the whole subtree
    - agents/notes             #   path -> matches from the content root
    - "*.draft.md"             #   `*` within a segment, `**` across segments

# API reference — see the OpenAPI section below.
openapi:
  specs:                       # name -> local file or URL; pages cite the name
    petstore: ./api/petstore.yaml
  tryIt: true                  # interactive console (default: true)
  auth:                        # only what an OpenAPI document cannot declare
    clientId: docs-portal
    scopes: [openid, profile]
    redirectUri: /oauth2/callback

theme:
  skin: default                # default | ocean | paper | helex | taltech | hl7lt
  wide: false                  # true = full-width layout (sidebar hard left, aside
                               # hard right) for wide tables / reference docs

# `search: true|false`, or an object to keep specific pages out of the index
# (they stay published — one huge generated page can otherwise dominate it).
search:
  enabled: true
  exclude:
    - glossary.md
    - CHANGELOG.md

# Comments (optional) — Giscus / GitHub Discussions, mounted after each page.
comments:
  provider: giscus
  repo: owner/repo
  repoId: R_xxx
  category: Announcements
  categoryId: DIC_xxx
  mapping: termx           # thread by the stable TermX page code (else: pathname, title, …)

# TermX terminology (optional) — FHIR server for {{csc:}}/{{vsc:}} and cs:/vs: links.
tx-server: https://your-termx-host/api/fhir

# Footer (optional) — shown on every page. Both fields allow inline HTML/links.
footer:
  message: Open source · Collaborative · Interoperable
  copyright: © 2026 Example Org

# Menu — added on top of the auto-generated nav/sidebar.
nav:
  - text: Home page
    link: https://example.org
sidebarExtra:
  - text: Appendix
    items:
      - { text: Glossary, link: /glossary }
# sidebar: [ ... ]             # set to fully OVERRIDE the generated sidebar

# Per-locale menu overrides (multilingual sites). By default the shared `nav`
# above is reused for every locale with its internal links localized
# (/build -> /lt/build); set a locale's `nav` here to fully control its labels
# and links, and `label` to rename it in the language switcher.
locales:
  lt:
    label: Lietuvių
    nav:
      - { text: Pradžia, link: /lt/ }
      - { text: Versijos, link: /lt/build }

build:
  out: .mdbook/dist
```

### Source formats

| Format | Detected by | Layout |
|---|---|---|
| `gitbook` | `SUMMARY.md` | `README.md` (home) + `SUMMARY.md` (nav) + `.gitbook/assets` |
| `termx` | `pages.json` (in `__source/`, `input/`, or `source/`) | `space.json` + `pages.json` + page markdown (+ `attachments/`) |

**Plain doc trees (no `SUMMARY.md`).** With the `gitbook` format, `SUMMARY.md` is optional:
point mdbook at any folder of markdown and it builds a **per-section sidebar automatically**
from the directory tree (each top-level folder gets its own sidebar so pages stay small on
large repos). Folder labels come from a `README.md` H1 (else the folder name); page labels
from each file's first H1; entries sort naturally (`01-…` before `10-…`). Add a `SUMMARY.md`
later to take manual control of the nav. Arbitrary markdown is also **hardened** for the Vue
compiler — a stray `<Placeholder>`/`</tag>` or `{{ … }}` in prose (common in API specs) is
escaped instead of crashing the build; real HTML, autolinks and code are left intact.

A menu label defaults to the page's first H1 (a folder's, to its `README.md` H1). When that
heading is long or cryptic, set a short label without touching the heading:

```yaml
---
sidebarTitle: ACC.11 Posting
---

# ACC.11 — Posting Rules (Common Spec, Consolidated)
```

**Breadcrumbs and related pages.** Every page gets a breadcrumb trail, and pages whose
filenames start with the same document id in *different* top-level sections are cross-linked
under a **Related** block — so `specifications/acc/ACC.11-…` and
`validations/specifications/acc/ACC.11-…-validation` point at each other. Ids listed in
`traces-from:` / `traces-to:` frontmatter are linked too. Recognised id forms are dotted
(`ACC.11`, `ACC.11.3`) and dashed (`ACC-US-010`, `FLOW-BP-003`); pages without one simply get
no Related block.

**TermX layout.** A TermX Wiki export — or a hand-authored equivalent — is `space.json`
(space metadata), `pages.json` (the page tree) and one markdown file per page. The metadata
and page directories are configurable:

```yaml
source:
  format: termx
  meta: source          # holds space.json + pages.json + attachments/  (default: __source)
  pages: source/pages   # page markdown, one file per slug
```

`pages.json` is a tree of nodes; each node has a stable `code` and one `contents` entry per
language (`name`, `slug`, `lang`):

```json
[
  {
    "code": "build",
    "contents": [
      { "name": "Builds",   "slug": "build",    "lang": "en" },
      { "name": "Versijos", "slug": "versijos", "lang": "lt" }
    ]
  }
]
```

TermX page bodies use `breaks: true` (a single newline becomes `<br>`), so keep each
paragraph on one line. Images are attachments: `*image*` (served from
`/attachments/…`). See **[helex-solutions/mdbook § reference projects](#reference-projects)**
for complete, working `space.json` / `pages.json` examples.

**Multilingual.** The default language (`site.lang`) is served at the root (`/…`) and other
locales under `/<lang>/…` (VitePress i18n); a language switcher appears automatically.

- *gitbook*: add a `<lang>/` subdirectory with its own `SUMMARY.md` + `README.md` + pages
  (e.g. `lt/…`). `.gitbook/assets` is shared; slugs are parallel (`/build` ↔ `/lt/build`).
- *termx*: each language has its own slug (from `pages.json`), so routes differ
  (`/build` ↔ `/lt/versijos`). mdbook generates **redirect stubs** so the language switcher
  still lands on the correct translation. Per-locale menu labels/links come from `locales`
  in the config.

**Card grids.** A bullet list tagged `{.card-grid}` renders as a responsive card grid. Each
item may carry an image (cover), a heading (title), text (description) and links tagged
`{.button}` (rendered as action buttons; add `.secondary` for an outlined variant). Use
`{.card-grid .cards-row}` for a horizontal (image-left) layout.

```markdown
- *image*
  ### LT Base
  Core Lithuanian FHIR Implementation Guide.
  [Latest Build](https://build.fhir.org/ig/HL7LT/ig-lt-base){.button}
  [History](https://hl7.lt/fhir/base/history.html){.button .secondary}
{.card-grid}
```

## OpenAPI

Point mdbook at one or more API documents and embed them in your pages. **OpenAPI 3.1**,
3.0 and Swagger 2.0 are all accepted; documents may be local files or URLs.

```yaml
openapi:
  specs:
    petstore: ./api/petstore.yaml
    billing:  https://api.example.com/openapi.json
```

A document behind authentication takes headers, with `${VAR}` resolved from the build
environment — a token belongs in CI, never in a config file:

```yaml
openapi:
  specs:
    mpi:
      url: https://api.example.com/api/mpi/api-docs
      headers:
        Authorization: Bearer ${API_TOKEN}
```

The token is used only to fetch the document; it is never written to the built site or the
cache. If the variable is unset, mdbook says so by name and falls back to the cached copy
rather than failing the build.

Documents are read **at build time**, not in the browser. That means the site works on an
air-gapped network, the docs are pinned to the spec they were built from, and — unlike a
client-side viewer — your API does **not** need to allow CORS from the docs site. A resolved
document is cached, so a later build still succeeds if a remote spec is briefly unreachable.

### Embedding — from whole document to one operation

```
{% openapi src="petstore" %}                            the whole document
{% openapi src="petstore" tag="Pets" %}                 one tag
{% openapi src="petstore" path="/pets" %}               every method on a path
{% openapi src="petstore" path="/pets" method="get" %}  one operation
{% openapi src="petstore" operation="listPets" %}       one operation, by operationId
{% openapi src="petstore" webhook="newPet" %}           a 3.1 webhook
{% openapi-schema src="petstore" name="Pet" %}          one schema
```

Each block expands to **markdown** — headings, parameter/response tables, descriptions — so
operations appear in the page outline and in site search like any other content, and work
with no JavaScript. Only the try-it console is interactive.

### Collapsed by default

A document with hundreds of operations is unreadable fully expanded, so each operation's
detail renders inside a `<details>` and starts **closed** — the page reads as a scannable
list of `METHOD /path` rows. The heading stays outside the fold, so anchors, deep links and
the page outline are unaffected, and because the detail is still in the HTML (merely closed)
it remains fully searchable and prints expanded.

```yaml
openapi:
  collapsed: true    # default; false renders every operation expanded
```

Override per block with `collapsed="false"`:

```
{% openapi src="petstore" operation="listPets" collapsed="false" %}
```

### Try it, with OpenID Connect

The API document already declares *where* to authenticate — a `securityScheme` of
`type: openIdConnect` carries a discovery URL, and `type: oauth2` carries the endpoints.
mdbook reads those, so config only supplies what a document cannot know:

```yaml
openapi:
  tryIt: true
  auth:
    clientId: docs-portal          # public client
    scopes: [openid, profile, api.read]
    redirectUri: /oauth2/callback  # must be registered with your provider
    issuer: https://id.example.com/realms/x   # only if the spec declares no scheme
    audience: https://api.example.com         # optional
```

mdbook generates the page at `redirectUri` for you. Login is **Authorization Code with
PKCE** — the only flow that is safe for a client that cannot keep a secret. There is
deliberately no support for a client secret or the implicit flow, and the access token is
held in `sessionStorage` (gone when the tab closes), never placed in a URL.

Set `tryIt: false` to render the reference documentation without any console — useful when
the API is internal and only the docs are public.

## Comments (GitHub Discussions)

mdbook can render a [Giscus](https://giscus.app) comment box after each page, backed by
**GitHub Discussions**. To enable it:

1. **Enable Discussions** on the repository: **Settings → General → Features → ☑ Discussions**.
2. **Install the giscus app** from <https://github.com/apps/giscus> and grant it access to the repo.
3. **Get the IDs**: open <https://giscus.app>, enter the repository, pick (or create) a Discussion
   **category** (e.g. *Comments*), then copy the generated `repoId` (`R_…`) and `categoryId` (`DIC_…`).
4. **Add a `comments` block** to `.mdbook/config.yml` and rebuild:

   ```yaml
   comments:
     provider: giscus
     repo: owner/repo
     repoId: R_xxxxx
     category: Comments
     categoryId: DIC_xxxxx
     mapping: termx      # thread by the stable TermX page code (survives renames);
                         #   or use pathname / title / og:title
   ```

Readers post with a one-time **“Sign in with GitHub”**; comments are stored as Discussions in the
repo (moderate/reply there or inline), and the widget follows the site's light/dark theme. Omit the
`comments` block to disable it.

## Presentation mode

A floating **⛶** button in the bottom-right corner of every page toggles a distraction-free view
for showing pages to an audience: it requests fullscreen and hides the nav, sidebar and
on-this-page aside, leaving only the article.

- **‹ / ›** edge buttons — or the **← / →** keys (also PageUp/PageDown) — move to the previous/next
  page in sidebar order.
- **Esc**, or the button (now a ⤢ exit icon), leaves the mode.

It stays on as you navigate and follows the site's light/dark theme. No configuration needed — the
button is always available.

## How it works

1. **Ingest** — a format adapter reads your content into a unified model
   (title, languages, per-locale sidebars, content files, assets).
2. **Stage** — content is copied into a scratch VitePress project under `.mdbook/.cache/`,
   with a generated `.vitepress/config.mjs` and a theme entry for the selected skin;
   TermX smart-text is transformed/expanded here.
3. **Build** — VitePress renders the static site to `.mdbook/dist`.

## Reference projects

Real repositories you can copy from — each links the live site and its `.mdbook/config.yml`:

| Project | Source | Live site | Repo |
|---|---|---|---|
| HL7 Lithuania Registry | `termx` (en/lt) | <https://hl7.lt> | [HL7LT/hl7lt-website](https://github.com/HL7LT/hl7lt-website/blob/main/.mdbook/config.yml) |
| TermX tutorial | `termx` (en/lt) | <https://termx-health.github.io/tutorial/> | [termx-health/tutorial](https://github.com/termx-health/tutorial/blob/main/.mdbook/config.yml) |
| Portfolio | `gitbook` | <https://helex-solutions.github.io/ib-portfolio/> | [helex-solutions/ib-portfolio](https://github.com/helex-solutions/ib-portfolio/blob/main/.mdbook/config.yml) |

Each config option, and a project that uses it:

| Config | Example project(s) |
|---|---|
| `source.format: gitbook` (`SUMMARY.md` + `README.md` + `.gitbook/assets`) | portfolio |
| `source.format: termx` + `meta` / `pages` (under `source/`) | hl7lt-website, tutorial |
| `site.url` (sitemap, canonical, Open Graph) | hl7lt-website |
| `theme.skin` | hl7lt-website (`hl7lt`), tutorial (`helex`), portfolio (`default`) |
| `search` | all three |
| `footer` (`message` + `copyright`) | hl7lt-website, tutorial |
| `nav` | hl7lt-website |
| `locales` (per-locale menu labels/links) | hl7lt-website |
| `tx-server` (`{{csc:}}` / `{{vsc:}}` tables, `cs:` / `vs:` links) | tutorial |
| `{{def:}}` StructureDefinition viewer | tutorial |
| `{.card-grid}` card grids | hl7lt-website, tutorial |
| Multilingual + locale-switch redirect stubs (`pages.json`) | hl7lt-website, tutorial |
| `comments` (Giscus) | see [Comments](#comments-github-discussions) above |

## License

MIT
