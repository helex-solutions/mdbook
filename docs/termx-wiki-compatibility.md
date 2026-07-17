# TermX Wiki → mdbook: differences reference

Reference for migrating **TermX Wiki** content (the `markdown-it` renderer in
`@termx-health/markdown-parser` / termx-web) to **mdbook**. Use it when planning the
TermX web docs migration.

mdbook is built on **VitePress**, which uses the same `markdown-it` engine as TermX Wiki,
so most syntax is reproduced natively. Where they differ it's almost always because a
static site can't do what a live app does (query a terminology server on the fly, run the
editor) or because VitePress renders Markdown output as a **Vue template** (stricter than
raw HTML). This file lists what matches, what differs, and how each gap is handled.

Legend: ✅ full parity · 🟡 works with a caveat · 🔴 not supported statically

---

## 1. Standard markdown-it extensions

| Feature | Syntax | TermX plugin | mdbook | Notes |
|---|---|---|---|---|
| Attribute lists | `{.class #id key=val}` | markdown-it-attrs | ✅ | Same plugin |
| Emoji | `:smile:` | markdown-it-emoji | ✅ | VitePress built-in |
| Subscript / Superscript | `H~2~O` / `x^2^` | markdown-it-sub/-sup | ✅ | |
| Highlight | `==mark==` | markdown-it-mark | ✅ | |
| Task lists | `- [ ]` / `- [x]` | markdown-it-task-lists | ✅ | Non-interactive |
| Footnotes | `[^1]` | markdown-it-footnote | ✅ | |
| Collapsible | `+++ Title … +++` | markdown-it-collapsible | ✅ | `<details>` |
| Multi-column tables | `^^` rowspan · `\|\|\|` colspan · multiline · headerless | markdown-it-multimd-table | ✅ | Same options (`multiline`, `rowspan`, `headerless`) |
| Line breaks | single newline → `<br>` | `breaks: true` | ✅ | Enabled for the `termx` source format |
| Linkify / typographer / raw HTML | — | core options | ✅ | |
| Abbreviations | `*[HTML]: HyperText…` | markdown-it-abbr | 🟡 | Not enabled (unused in the tutorial); one-line add if a space needs it |

## 2. TermX "smart text"

| Feature | Syntax | mdbook | Notes |
|---|---|---|---|
| Callout blockquotes | `> text {.is-info\|is-warning\|is-success\|is-error}` | ✅ | Matched via `blockquote:has(> .is-*)` — attrs lands the class on the inner `<p>`; semantic info/success/warning/error colours |
| Tabsets | `## {.tabset}` + `### Tab` (+ closing `##`) | ✅ | Pure-CSS tabs (`input:checked + label + .tab`), same markup as the SSG |
| Link lists | list + `{.links-list}` | ✅ | Shadow cards; a link's trailing `*em*` renders as a divider-separated **subtitle**; the current page's row gets a brand **left accent bar** (also on hover) |
| Grid lists | list + `{.grid-list}` | ✅ | Zebra-striped rows |
| Dense | `{.dense}` | 🟡 | Applies to lists; **not to multimd tables** (attrs can't attach to the multimd token) — the orphan marker is stripped so it never shows as text |
| Page icons | `icon:` front-matter | ✅ | Rendered as sidebar icons from Font Awesome Free (Pro names aliased to free) |
| Link schemes | `[t](cs\|csv\|vs\|vsv\|ms\|msv\|concept\|page\|namespace:…)` | ✅ | See §5 for how each resolves |
| Attachment images | `![](files/<pageId>/<file>)` | ✅ | Rewritten to `/attachments/<pageId>/<file>`, served from the exported `attachments/`; missing local images are dropped so the build never fails |
| Draw.io | ` ```drawio ` (base64 SVG) | ✅ | Inline `data:` URI `<img>` |
| Mermaid | ` ```mermaid ` | ✅ | Rendered client-side (mermaid), theme-aware |
| PlantUML | ` ```plantuml ` | ✅ | Encoded (`plantuml-encoder`) to the PlantUML server — needs internet at view time |
| GitBook card tables | `<table data-view="cards">` | ✅ | Converted to a card grid (also cover-image and linked-title variants) — for GitBook-sourced spaces |
| Include: StructureDefinition | `{{def:code; type=diff\|snap\|hybrid}}` | ✅ | Rendered by the vendored `@termx-health/structure-definition-viewer` from the exported `__source/resources/structure-definition/<code>.json` |
| Include: CodeSystem concepts | `{{csc:code\|ver; properties=…; langs=…; limit=…}}` | ✅ | Fetched at build time from the FHIR server: `GET {tx-server}/CodeSystem/{code}` → inline `concept[]`. Card fallback if `tx-server` is unset or the fetch fails |
| Include: ValueSet concepts | `{{vsc:code\|ver; …}}` | ✅ | Fetched at build time: `GET {tx-server}/ValueSet/{code}/$expand?includeDesignations=true` → `expansion.contains[]`. Same fallback |

## 3. Editor-only features (not applicable to a static site)

| Feature | mdbook |
|---|---|
| Inline comments (`data-source-line`, comment popovers) | 🔴 N/A — authoring feature |
| Quick-action toolbar / drawio editor | 🔴 N/A — authoring feature |
| Code copy buttons | ✅ VitePress provides its own |

## 4. Rendering-engine differences (VitePress/Vue)

TermX renders markdown-it's HTML directly; VitePress compiles it as a **Vue template**,
which is stricter. mdbook normalizes content at build time so these never break:

| Issue | Cause | Handling |
|---|---|---|
| `{{ … }}` treated as Vue interpolation | `{{def/csc/vsc:…}}` and any `{{…}}` | rendered `v-pre` (inline code / expanded), so Vue leaves them alone |
| "Element is missing end tag" | Wiki.js unclosed `<span>` autolink-breakers (`Draw.<span>io`) | stripped during staging |
| Custom elements | `<tx-sd-view>` (SD viewer) | declared to Vue via `isCustomElement` |
| Unknown fence language hard-fails the build | e.g. a stray ` ```s ` | normalized to a real language (`s → sh`); extend the alias map for others |
| markdown-it-attrs crash on multimd tables | attrs reads `token.meta.colsnum`, which is `null` on multimd tokens | block tokens get a non-null `meta` before attrs runs |

## 5. Structural / routing differences

- **Multilingual routes.** TermX SSG uses `/en/…`, `/lt/…`. mdbook serves the **default
  language at the root** (`/…`) and other locales under `/<lang>/…` (VitePress i18n).
  A page appears in a locale only if it is actually translated in that language.
- **Menu.** Built from `pages.json`; groups are collapsible/collapsed like the SSG. Config
  can add nav/sidebar entries or fully override the sidebar.
- **Page links.** `page:slug` → the internal page when it exists in this build; otherwise
  (and for cross-space `page:space/slug`) → the page on the TermX web wiki
  `{web}/wiki/{space}/{slug}`, so the link still reaches a real page.
- **Terminology links.** `cs:`/`vs:`/`ms:`/`concept:` → the TermX web UI (see §6 for the base).
  With only a FHIR base configured, they fall back to FHIR resource URLs.
- **Home page.** The SSG lands on the first page (`/en/about`); mdbook maps the first page
  to the site root (`/`) and also keeps it at its slug.

## 6. Configuration for terminology

Terminology directives and links use a **FHIR server**, set once in `.mdbook/config.yml`:

```yaml
tx-server: https://your-termx-host/api/fhir   # FHIR API base (…/fhir)
```

- `{{csc:}}` / `{{vsc:}}` are expanded to tables at build time from this server.
- `cs:` / `vs:` / `concept:` and web `page:` links use a **web UI base** chosen in order:
  1. an explicit `site.web` in config,
  2. else the **tx-server's own web origin** (its URL with `/api/fhir` or `/fhir` stripped —
     so links follow the configured server),
  3. else the space's `web` (from `space.json`).

  Set `site.web` to point links somewhere other than `tx-server`.

## 7. Remaining gaps to close for full parity

1. **`{.dense}` on multimd tables** — attach the class to the table element during staging
   (markdown-it-attrs can't, after the multimd token).
2. **Abbreviations** — add `markdown-it-abbr` if any space uses `*[X]:`.
3. **Concept-matrix columns** — `code`/`display`/`definition` and designation/property columns
   are supported; exotic property projections may need extra mapping.
4. **PlantUML / Mermaid offline** — PlantUML needs the render server at view time; both could
   be pre-rendered to static SVG at build time if fully-offline output is required.

## 8. Where it's implemented in mdbook

- **Markdown plugins:** `src/markdown/` — `index.mjs` (chain + meta guard), `termx-links.mjs`,
  `termx-images.mjs`, `termx-embeds.mjs`, `collapsible.mjs`, `tabset.mjs`, `diagrams.mjs`
- **Build-time expansions / normalization:** `src/ingest/` — `structure-definition.mjs`,
  `concept-matrix.mjs`, `cards.mjs`, `sanitize.mjs`, `images.mjs`
- **Ingestion adapters:** `src/ingest/` — `termx.mjs`, `gitbook.mjs`
- **Client runtime + styles:** `src/theme/` — mermaid + `<tx-sd-view>` registration +
  current-link marking, `styles/smart-text.css`, `skins/`
- **Vendored viewer:** `vendor/structure-definition-viewer/`
