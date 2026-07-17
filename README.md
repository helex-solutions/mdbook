# mdbook

A Markdown + metadata static-site generator for tutorials, specifications and books.
It turns **TermX Wiki** exports and **GitBook** repositories into a fast, searchable,
themeable, multilingual website — and ships as a **GitHub Action**.

Built on [VitePress](https://vitepress.dev) (which uses `markdown-it`), so the TermX
Wiki "smart text" plugins run natively.

## Features

- 🔎 **Search** — built-in local full-text search (no external service)
- 🎨 **Skins** — swappable themes (`default`, `ocean`, `paper`, plus brand skins `helex` and `taltech`) via CSS-variable palettes
- 🧭 **Custom menu** — nav & sidebar auto-generated from your content, extendable/overridable in config
- 🖼️ **Assets** — GitBook `.gitbook/assets` and TermX `files/<id>/…` attachments handled automatically
- 🌍 **Multilingual** — first-class locales, driven by the `lang` on TermX page contents
- 🧩 **Plugins** — the `markdown-it` plugin chain, including TermX links (`page:` `cs:` `vs:` `concept:`), `files/` images, `+++` collapsibles, `{.is-info}` callouts

## Source formats

| Format | Detected by | Layout |
|---|---|---|
| `gitbook` | `SUMMARY.md` | `README.md` (home) + `SUMMARY.md` (nav) + `.gitbook/assets` |
| `termx` | `__source/pages.json` or `input/pages.json` | `space.json` + `pages.json` + `input/*.md` (or `input/pagecontent/*.md`) |

Format is auto-detected but can be set explicitly in `.mdbook/config.yml`.

## Usage

### As a GitHub Action

Add a `.mdbook/` config folder to your project (see below), then a workflow:

```yaml
- uses: igorboss/mdbook@main
  id: mdbook
  with:
    project: .            # folder containing .mdbook/
- uses: actions/upload-pages-artifact@v3
  with:
    path: ${{ steps.mdbook.outputs.site }}
```

A complete build-and-deploy-to-Pages workflow is in
`.github/workflows/mdbook.yml` of each migrated project.

### Locally

```bash
npx github:igorboss/mdbook build --project .   # build to .mdbook/dist
npx github:igorboss/mdbook dev   --project .   # live-reload dev server
```

## Configuration — `.mdbook/config.yml`

```yaml
site:
  title: My Space              # falls back to space.json names / repo name
  description: One-line summary
  lang: en                     # default locale
  base: /                      # set to /repo/ for GitHub project pages
  logo: /logo.svg

source:
  format: gitbook              # gitbook | termx  (auto-detected if omitted)
  # gitbook: root, summary, home, assets
  # termx:   meta, pages, assets

theme:
  skin: default                # default | ocean | paper | helex | taltech

search: true

# Menu: added on top of the auto-generated nav/sidebar.
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

## How it works

1. **Ingest** — a format adapter reads your content into a unified model
   (title, languages, per-locale sidebars, content files, assets).
2. **Stage** — content is copied into a scratch VitePress project under `.mdbook/.cache/`,
   with a generated `.vitepress/config.mjs` (from the model) and a theme entry that
   imports the selected skin.
3. **Build** — VitePress renders the static site to `.mdbook/dist`.

## Roadmap

- [x] GitBook ingestion + Pages deploy (portfolio)
- [ ] TermX multilingual ingestion (tutorial, ccm-specs)
- [ ] Build-time expansion of `{{csc:}}` / `{{vsc:}}` / `{{def:}}` terminology embeds
- [ ] drawio / PlantUML / Mermaid diagram rendering
- [ ] Live skin switcher component

## License

MIT
