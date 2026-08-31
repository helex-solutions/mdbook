# Owliki → mdbook: differences reference

Reference for publishing **Owliki** wiki content as a static site with **mdbook**. It
covers the reference wiki Owliki succeeds too — a `markdown-it` renderer like this one —
because both write the same dialect, which is the point of it. Use it when planning a
wiki-to-site migration.

mdbook is built on **VitePress**, which uses the same `markdown-it` engine as the wiki,
so most syntax is reproduced natively. Where they differ it's almost always because a
static site can't do what a live app does (query a terminology server on the fly, run the
editor) or because VitePress renders Markdown output as a **Vue template** (stricter than
raw HTML). This file lists what matches, what differs, and how each gap is handled.

Legend: ✅ full parity · 🟡 works with a caveat · 🔴 not supported statically

---

## 1. Standard markdown-it extensions

| Feature | Syntax | Wiki plugin | mdbook | Notes |
|---|---|---|---|---|
| Attribute lists | `{.class #id key=val}` | markdown-it-attrs | ✅ | Same plugin |
| Emoji | `:smile:` | markdown-it-emoji | ✅ | VitePress built-in |
| Subscript / Superscript | `H~2~O` / `x^2^` | markdown-it-sub/-sup | ✅ | |
| Highlight | `==mark==` | markdown-it-mark | ✅ | |
| Task lists | `- [ ]` / `- [x]` | markdown-it-task-lists | ✅ | Non-interactive |
| Footnotes | `[^1]` | markdown-it-footnote | ✅ | |
| Collapsible | `+++ Title … +++` | markdown-it-collapsible | ✅ | `<details>` |
| Multi-column tables | `^^` rowspan · `\|\|\|` colspan · multiline · headerless | markdown-it-multimd-table | ✅ | Same options (`multiline`, `rowspan`, `headerless`) |
| Line breaks | single newline → `<br>` | `breaks: true` | ✅ | Enabled for the `owliki` source format |
| Linkify / typographer / raw HTML | — | core options | ✅ | |
| Abbreviations | `*[HTML]: HyperText…` | markdown-it-abbr | 🟡 | Not enabled (unused in the tutorial); one-line add if a space needs it |

## 2. Owliki "smart text"

| Feature | Syntax | mdbook | Notes |
|---|---|---|---|
| Callout blockquotes | `> text {.is-info\|is-warning\|is-success\|is-error}` | ✅ | Matched via `blockquote:has(> .is-*)` — attrs lands the class on the inner `<p>`; semantic info/success/warning/error colours |
| Tabsets | `## {.tabset}` + `### Tab` (+ closing `##`) | ✅ | Pure-CSS tabs (`input:checked + label + .tab`), same markup as the SSG |
| Link lists | list + `{.links-list}` | ✅ | Shadow cards; a link's trailing `*em*` renders as a divider-separated **subtitle**; the current page's row gets a brand **left accent bar** (also on hover) |
| Grid lists | list + `{.grid-list}` | ✅ | Zebra-striped rows |
| Dense | `{.dense}` | ✅ | Applies to lists (via attrs) **and** multimd tables (the `tableAttrs` rule attaches an orphaned `{.dense}`/`{…}` after a table to the table element) |
| Page icons | `icon:` front-matter | ✅ | Rendered as sidebar icons from Font Awesome Free (Pro names aliased to free) |
| Link schemes | `[t](cs\|csv\|vs\|vsv\|ms\|msv\|concept\|page\|namespace:…)` | ✅ | See §5 for how each resolves |
| Attachment images | `![](files/<pageId>/<file>)` | ✅ | Rewritten to `/attachments/<pageId>/<file>`, served from the exported `attachments/`; missing local images are dropped so the build never fails |
| Draw.io | ` ```drawio ` (base64 SVG) | ✅ | Inline `data:` URI `<img>` |
| Draw.io, versioned | `{{drawio:name}}` | ✅ | Resolved at build time to the **highest** `name.vN.drawio.png` in the page's attachments, emitted as an ordinary `files/…` embed. See §2.1 |
| Mermaid | ` ```mermaid ` | ✅ | Rendered client-side, theme-aware, with `securityLevel: 'strict'` and root-level `htmlLabels: false` — the same two settings the wiki states |
| PlantUML | ` ```plantuml ` | ✅ | Encoded (`plantuml-encoder`) to the server set in `diagrams.plantumlServer`; `@startuml`/`@enduml` added when the source has no `@start` marker. **No default** — with none configured the fence renders as a code block and nothing is fetched |
| GitBook card tables | `<table data-view="cards">` | ✅ | Converted to a card grid (also cover-image and linked-title variants) — for GitBook-sourced spaces |
| Card grid with buttons | list + `{.card-grid}` | ✅ | Markdown-authored card grid: per-item image (cover), heading (title), text (description) and `{.button}` links (rendered as `a.mdbook-card-btn`; `.secondary` = outlined). `{.card-grid .cards-row}` for a horizontal layout. See `src/markdown/card-grid.mjs` |
| Include: StructureDefinition | `{{def:code; type=diff\|snap\|hybrid}}` | 🟡 | An include card naming the definition. The element tree needs a viewer mdbook can no longer ship: see §2.2 |
| Include: CodeSystem concepts | `{{csc:code\|ver; properties=…; langs=…; limit=…}}` | ✅ | Fetched at build time from the FHIR server: `GET {tx-server}/CodeSystem/{code}` → inline `concept[]`. Card fallback if `tx-server` is unset or the fetch fails |
| Include: ValueSet concepts | `{{vsc:code\|ver; …}}` | ✅ | Fetched at build time: `GET {tx-server}/ValueSet/{code}/$expand?includeDesignations=true` → `expansion.contains[]`. Same fallback |

### 2.1 `{{drawio:name}}` — which file the macro means

A diagram is a page attachment in draw.io's `xmlpng` format, and attachments are
immutable by name, so every save writes a new version: `architecture.v1.drawio.png`,
`architecture.v2.drawio.png`, `architecture.v10.drawio.png`. The macro names the
**diagram**, and always resolves to the highest version **by parsed number** — never
by filename order (`v10` beats `v2`), listing order, or upload time. A file with no
`.vN.` segment is not one of these: pre-macro diagrams are plain
`![](files/12/diagram-1.drawio.png)` embeds and keep rendering as ordinary images.

The wiki resolves the same macro at read time, from the live attachment list, in
helex-tx `modules/owliki/frontend/src/components/diagramLinks.ts`. Two implementations
of one rule drift silently and the failure mode is a published page showing an older
diagram than the wiki, so `src/ingest/diagram-files.mjs` is a deliberate transcription
of that file and `test/drawio.test.mjs` mirrors its cases. **Change one, change both.**

**Which page's attachments.** Attachments publish to `attachments/<pageId>/<name>`
(OWLIKI.07 §3.4), but the macro names no page and `pages.json` publishes no page id.
mdbook recovers the folder in descending order of certainty:

1. `pages.json` node `pageId` — exact, and the only exact answer. Additive to the
   wiki-ssg contract, like `tags` and `access`; absent today (see below).
2. A folder the page already embeds from through `files/<folder>/…`.
3. The whole export, when exactly one folder holds a diagram of that name.

When several folders hold the name and nothing narrows them, the macro renders a
named placeholder and the build warns — it never picks one. Diagram names collide
by construction: the wiki's editor names new diagrams `diagram`, `diagram-2`, … per
page, so a guess would show another page's picture, silently.

> **Publisher follow-up.** `WikiMdbookDataHandler.pagesJson` (helex-tx) should emit
> `"pageId": <id>` per node — one line, and it makes rule 1 the normal path instead
> of the exception. Until it does, a published page whose only attachment is a
> default-named diagram cannot be resolved.

### 2.2 `{{def:}}` renders an include card, not an element tree

`{{def:code}}` renders a card naming the definition. It used to expand to a
`<tx-sd-view>` web component that drew the full element tree — cardinality, flags, types,
bindings — from a StructureDefinition JSON in the export. That viewer came from the
superseded vendor's package family, vendored into this repository to avoid a registry
login; the dependency is no longer permitted, and vendoring a copy does not change what
the dependency is. The generator now ships no viewer at all.

The Helex FHIR package is not a substitute as it stands. `@helex-solutions/fhir` exports
a **React** component with `antd` among its peers and publishes to GitHub Packages — so
adopting it would mount a React runtime into every page of a static site and reintroduce
the CI-auth problem vendoring was done to avoid. mdbook is Vue, and a docs generator
should not carry two frameworks to draw one table.

> **What would restore the tree.** A web-component build of the Helex viewer — the same
> shape as the one removed: a custom element taking the resource as an attribute, with no
> framework of its own. The build-time half is a small module again at that point: read the
> JSON beside the export, emit the element, and add its tag to `MDBOOK_ELEMENTS` (which is
> also declared to Vue as a custom element — the two must move together, or the markup
> renders as escaped text).
>
> A second thing is missing either way: `WikiMdbookDataHandler` publishes no
> `resources/structure-definition/<code>.json`, so an Owliki repo has no resource for a
> viewer to draw even once one exists.

## 3. Editor-only features (not applicable to a static site)

| Feature | mdbook |
|---|---|
| Inline comments (`data-source-line`, comment popovers) | 🔴 N/A — authoring feature |
| Quick-action toolbar / drawio editor | 🔴 N/A — authoring feature |
| Code copy buttons | ✅ VitePress provides its own |

## 4. Rendering-engine differences (VitePress/Vue)

The wiki renders markdown-it's HTML directly; VitePress compiles it as a **Vue template**,
which is stricter. mdbook normalizes content at build time so these never break:

| Issue | Cause | Handling |
|---|---|---|
| `{{ … }}` treated as Vue interpolation | `{{def/csc/vsc:…}}` and any `{{…}}` | rendered `v-pre` (inline code / expanded), so Vue leaves them alone |
| "Element is missing end tag" | Wiki.js unclosed `<span>` autolink-breakers (`Draw.<span>io`) | stripped during staging |
| Custom elements | none are emitted today | the `MDBOOK_ELEMENTS` / `isCustomElement` pair is kept as one seam, since exempting a tag from only one half renders it as escaped literal markup |
| Unknown fence language hard-fails the build | e.g. a stray ` ```s ` | normalized to a real language (`s → sh`); extend the alias map for others |
| markdown-it-attrs crash on multimd tables | attrs reads `token.meta.colsnum`, which is `null` on multimd tokens | block tokens get a non-null `meta` before attrs runs |

## 5. Structural / routing differences

- **Multilingual routes.** The reference SSG uses `/en/…`, `/lt/…`. mdbook serves the **default
  language at the root** (`/…`) and other locales under `/<lang>/…` (VitePress i18n).
  A page appears in a locale only if it is actually translated in that language. For
  **gitbook** sources, additional locales are authored as `<lang>/` subdirectories, each with
  its own `SUMMARY.md` + `README.md` + pages.
- **Locale-switch redirects.** VitePress's language switcher swaps only the locale prefix
  (keeping the current slug). When a page's slug differs per language (e.g. `/build` vs
  `/lt/versijos`, common in the wiki, where each language has its own slug), the swapped path
  (`/lt/build`) would 404. mdbook emits a small **redirect stub** at that path — derived from
  the per-code slug mapping in `pages.json` — that bounces to the real translation, so the
  switcher always lands on the correct page (`src/ingest/owliki.mjs` + the `redirect`
  front-matter handled in `src/theme/index.mjs`).
- **Menu.** Built from `pages.json`; groups are collapsible/collapsed like the SSG. Config
  can add nav/sidebar entries or fully override the sidebar. On multilingual sites the shared
  `nav`/`sidebarExtra` links are localized per locale (`/build` → `/lt/build`); a `locales:`
  block can override a locale's menu labels/links and its switcher label.
- **Page links.** `page:slug` → the internal page when it exists in this build; otherwise
  (and for cross-space `page:space/slug`) → the page in the live wiki
  `{web}/wiki/{space}/{slug}`, so the link still reaches a real page.
- **Terminology links.** `cs:`/`vs:`/`ms:`/`concept:` → the Helex TX web UI (see §6 for the base).
  With only a FHIR base configured, they fall back to FHIR resource URLs.
- **Home page.** The SSG lands on the first page (`/en/about`); mdbook maps the first page
  to the site root (`/`) and also keeps it at its slug.

## 6. Configuration for terminology

Terminology directives and links use a **FHIR server**, set once in `.mdbook/config.yml`:

```yaml
tx-server: https://your-helextx-host/api/fhir   # FHIR API base (…/fhir)
```

- `{{csc:}}` / `{{vsc:}}` are expanded to tables at build time from this server.
- `cs:` / `vs:` / `concept:` and web `page:` links use a **web UI base** chosen in order:
  1. an explicit `site.web` in config,
  2. else the **tx-server's own web origin** (its URL with `/api/fhir` or `/fhir` stripped —
     so links follow the configured server),
  3. else the space's `web` (from `space.json`).

### Generator config from the wiki (`space.json` → `ssg`)

The Owliki space carries the generator settings you'd otherwise hand-write in
`.mdbook/config.yml`, exported under an `ssg` block in `space.json`:

```json
"ssg": {
  "theme":  { "skin": "helex" },
  "footer": { "message": "…", "copyright": "…" },
  "txServer": "https://your-helextx-host/api/fhir",
  "search": true,
  "logo": "files/1/logo.png"
}
```

These become the **base** config (`theme.skin`, `footer`, `tx-server`,
`search`, `site.logo`). A repo's own `.mdbook/config.yml` still wins — it only fills what the
config didn't set explicitly — so you can configure everything in the wiki and keep `config.yml`
optional, or override individual fields per repo. Applied by `applySpaceConfig` in `src/config.mjs`.

  Set `site.web` to point links somewhere other than `tx-server`.

## 7. Remaining gaps to close for full parity

1. **Abbreviations** — add `markdown-it-abbr` if any space uses `*[X]:`.
2. **Concept-matrix columns** — `code`/`display`/`definition` and designation/property columns
   are supported; exotic property projections may need extra mapping.
3. **PlantUML / Mermaid offline** — PlantUML needs the render server at view time; both could
   be pre-rendered to static SVG at build time if fully-offline output is required.
4. **Publisher-side, not here** — `{{drawio:}}` wants `pageId` in `pages.json` (§2.1) and
   `{{def:}}` wants `resources/structure-definition/<code>.json` in the published tree (§2.2).
   Both are one addition each to helex-tx's `WikiMdbookDataHandler`; the generator reads them
   already.

Source-syntax convergence (which constructs are rewritten in the wiki so both renderers agree,
and which are handled here) is specified in the wiki repo's `docs/wiki-mdbook-syntax.md`.

## 8. Where it's implemented in mdbook

- **Markdown plugins:** `src/markdown/` — `index.mjs` (chain + meta guard), `owliki-links.mjs`,
  `owliki-images.mjs`, `owliki-embeds.mjs`, `collapsible.mjs`, `tabset.mjs`, `diagrams.mjs`,
  `table-attrs.mjs` (orphaned `{…}` after a multimd table)
- **Build-time expansions / normalization:** `src/ingest/` — `structure-definition.mjs`,
  `concept-matrix.mjs`, `cards.mjs`, `sanitize.mjs`, `images.mjs`, and for `{{drawio:}}`
  `diagram-files.mjs` (the version rules, mirroring the wiki's own) + `drawio.mjs` (which
  page's attachments, and the expansion)
- **SEO / metadata:** `src/ingest/seo.mjs` + `src/vitepress.mjs` (`seoHead`) — per-page
  title/description and space-level description/languages/URL are read from the export
  (`space.json` / `pages.json`) with inference as the fallback; page tags become
  `<meta name="keywords">`
- **Generator config from the space:** `src/config.mjs` (`applySpaceConfig`) merges the
  `space.json` `ssg` block (theme/footer/tx-server/search/logo) as config defaults, with a
  repo's `.mdbook/config.yml` still winning
- **Ingestion adapters:** `src/ingest/` — `owliki.mjs`, `gitbook.mjs`
- **Client runtime + styles:** `src/theme/` — mermaid rendering +
  current-link marking, `styles/smart-text.css`, `skins/`
