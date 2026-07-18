# mdbook

A Markdown + metadata static-site generator for tutorials, specifications and books.
It turns **TermX Wiki** exports and **GitBook** repositories into a fast, searchable,
themeable, multilingual website — and ships as a **GitHub Action**.

Built on [VitePress](https://vitepress.dev) (which uses `markdown-it`), so the TermX
Wiki "smart text" runs natively.

## Features

- 🔎 **Search** — built-in local full-text search (no external service)
- 🎨 **Skins** — swappable themes (`default`, `ocean`, `paper`, plus brand skins `helex`, `taltech`)
- 🧭 **Menu** — nav & sidebar auto-generated from your content; extendable or overridable in config
- 🌍 **Multilingual** — first-class locales (default language at `/`, others under `/<lang>/`)
- 🧩 **TermX smart-text** — callouts, tabsets, links-list/grid-list, `+++` collapsibles, `page:`/`cs:`/`vs:`/`concept:` links, `files/` images, page icons, GitBook card tables
- 📊 **Diagrams** — drawio, Mermaid, PlantUML
- 🔗 **Terminology** — `{{def:}}` StructureDefinition viewer, and `{{csc:}}`/`{{vsc:}}` concept tables fetched from a FHIR server at build time
- 🏷️ **SEO** — per-page titles/descriptions, `sitemap.xml`, canonical + Open Graph/Twitter tags, JSON-LD and `robots.txt` (site URL auto-detected in CI)
- 💬 **Comments** — optional [Giscus](https://giscus.app) (GitHub Discussions) box per page (see [Comments](#comments-github-discussions))
- 🖥️ **Presentation mode** — a fullscreen, chrome-free view with prev/next controls for showing pages to an audience (see [Presentation mode](#presentation-mode))

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
     skin: default            # default | ocean | paper | helex | taltech
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
           uses: igorboss/mdbook@v1.0.0   # pin to a release tag (see Versioning)
           with: { project: . }
         - uses: actions/configure-pages@v5
         - uses: actions/upload-pages-artifact@v3
           with: { path: ${{ steps.mdbook.outputs.site }} }
     deploy:
       needs: build
       runs-on: ubuntu-latest
       environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
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

Pin the action to a **release tag** (e.g. `igorboss/mdbook@v1.0.0`) so your site builds are
deterministic — `main` can move without silently redeploying your site. See the
[releases](https://github.com/igorboss/mdbook/releases). Use `@main` only if you want the
latest, unreleased changes.

**To publish a new mdbook version:**

```bash
git tag -a v1.0.1 -m "…" && git push origin v1.0.1   # patch; v1.1.0 for features
```

Then bump `@v1.0.0` → `@v1.0.1` in each consumer's `.github/workflows/mdbook.yml` and push —
a deliberate step, so upgrades are reviewed rather than automatic.

## Local preview

```bash
npx github:igorboss/mdbook build --project .   # build to .mdbook/dist
npx github:igorboss/mdbook dev   --project .   # live-reload dev server
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

theme:
  skin: default                # default | ocean | paper | helex | taltech

search: true

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

# Menu — added on top of the auto-generated nav/sidebar.
nav:
  - text: Home page
    link: https://example.org
sidebarExtra:
  - text: Appendix
    items:
      - { text: Glossary, link: /glossary }
# sidebar: [ ... ]             # set to fully OVERRIDE the generated sidebar

build:
  out: .mdbook/dist
```

### Source formats

| Format | Detected by | Layout |
|---|---|---|
| `gitbook` | `SUMMARY.md` | `README.md` (home) + `SUMMARY.md` (nav) + `.gitbook/assets` |
| `termx` | `__source/pages.json` or `input/pages.json` | `space.json` + `pages.json` + `input/*.md` (or `input/pagecontent/*.md`) |

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

## Live examples

- Portfolio (GitBook source): <https://helex-solutions.github.io/ib-portfolio/>
- TermX tutorial (TermX source, en/lt): <https://termx-health.github.io/tutorial/>

## License

MIT
