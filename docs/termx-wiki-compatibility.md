# TermX Wiki → mdbook syntax compatibility

Reference for migrating **TermX Wiki** content (the `markdown-it`-based renderer in
`@termx-health/markdown-parser` / termx-web) to **mdbook**. Use it when planning the
TermX web docs migration.

mdbook is built on VitePress, which uses the same `markdown-it` engine as TermX Wiki,
so most syntax is reproduced natively. This file lists **what matches**, **what differs**,
and **what isn't supported** in a static build.

Legend: ✅ full parity · 🟡 works with a caveat · 🔴 not supported statically

---

## Standard markdown-it extensions

| Feature | Syntax | TermX plugin | mdbook | Notes |
|---|---|---|---|---|
| Attribute lists | `{.class #id key=val}` | markdown-it-attrs | ✅ | Same plugin |
| Emoji | `:smile:` | markdown-it-emoji | ✅ | VitePress built-in |
| Subscript | `H~2~O` | markdown-it-sub | ✅ | |
| Superscript | `x^2^` | markdown-it-sup | ✅ | |
| Highlight | `==mark==` | markdown-it-mark | ✅ | |
| Task lists | `- [ ]` / `- [x]` | markdown-it-task-lists | ✅ | Non-interactive |
| Footnotes | `[^1]` | markdown-it-footnote | ✅ | |
| Collapsible | `+++ Title … +++` | markdown-it-collapsible | ✅ | `<details>` |
| Multi-column tables | `^^` rowspan, `\|\|\|` colspan, multiline, headerless | markdown-it-multimd-table | ✅ | Same options (`multiline`, `rowspan`, `headerless`) |
| Line breaks | single newline → `<br>` | `breaks: true` | ✅ | Enabled for `termx` source format |
| Linkify / typographer / raw HTML | — | core options | ✅ | |
| Abbreviations | `*[HTML]: HyperText…` | markdown-it-abbr | 🟡 | Not enabled (0 uses in the tutorial); trivial to add if needed |

## TermX "smart text"

| Feature | Syntax | mdbook | Notes |
|---|---|---|---|
| Callout blockquotes | `> text {.is-info\|is-warning\|is-success\|is-error}` | ✅ | Matched via `blockquote:has(> .is-*)` — attrs lands the class on the inner `<p>` |
| Tabsets | `## {.tabset}` + `### Tab` (+ closing `##`) | ✅ | Pure-CSS tabs (`input:checked + label + .tab`), same markup as the SSG |
| Link lists | list + `{.links-list}` | ✅ | Shadow cards |
| Grid lists | list + `{.grid-list}` | ✅ | Soft-filled stacked rows |
| Dense | `{.dense}` | 🟡 | Works on lists; **not applied to multimd tables** (attrs can't attach to the multimd token) — the orphan marker is stripped so it doesn't show |
| Link schemes | `[t](cs\|csv\|vs\|vsv\|ms\|msv\|concept\|page\|namespace:…)` | ✅ | See routing notes below |
| Attachment images | `![](files/<pageId>/<file>)` | ✅ | Rewritten to `/attachments/<pageId>/<file>`; served from the exported `attachments/` |
| Draw.io | ` ```drawio ` (base64 SVG) | ✅ | Inline `data:` URI |
| Mermaid | ` ```mermaid ` | ✅ | Rendered client-side (mermaid) |
| PlantUML | ` ```plantuml ` | ✅ | Encoded to the PlantUML server (`plantuml.com`) — needs internet at view time |
| Include: StructureDefinition | `{{def:code; type=diff\|snap\|hybrid}}` | ✅ | Rendered by the vendored `@termx-health/structure-definition-viewer` from the exported `__source/resources/structure-definition/<code>.json` |
| Include: CodeSystem concepts | `{{csc:code\|ver; properties=…; langs=…; limit=…}}` | ✅ | Fetched at build time from the FHIR server (`txServer`): `GET {txServer}/CodeSystem/{code}` → inline `concept[]`. Falls back to a card if `txServer` is unset or the fetch fails |
| Include: ValueSet concepts | `{{vsc:code\|ver; …}}` | ✅ | Fetched at build time: `GET {txServer}/ValueSet/{code}/$expand?includeDesignations=true` → `expansion.contains[]`. Same fallback |

## Editor-only features (not applicable to a static site)

| Feature | mdbook |
|---|---|
| Inline comments (`data-source-line`, comment popovers) | 🔴 N/A — authoring feature |
| Quick-action toolbar / drawio editor | 🔴 N/A — authoring feature |
| Code copy buttons | ✅ VitePress provides its own |

---

## Structural / routing differences

- **Multilingual routes.** TermX SSG uses `/en/…`, `/lt/…`. mdbook serves the **default
  language at the root** (`/…`) and other locales under `/<lang>/…` (VitePress i18n).
- **Cross-space page links.** `page:space/slug` resolves to another space on the live wiki;
  in a single-space static build it resolves to `/slug` (dead link if not present).
  `ignoreDeadLinks` is on so the build never fails on these.
- **Terminology resource links.** `cs:`/`vs:`/`concept:` etc. become **external links to the
  TermX web instance** (`space.json.web`), not in-app routes — by design for a static site.
- **Home page.** The TermX SSG lands on the first page (e.g. `/en/about`); mdbook maps the
  first page to the site root (`/`) and also keeps it at its slug.

## Configuration for terminology

Terminology directives and links use a **FHIR server**, set once in `.mdbook/config.yml`:

```yaml
tx-server: https://your-termx-host/api/fhir   # FHIR API base (…/fhir)
```

- `{{csc:}}` / `{{vsc:}}` are expanded to tables at build time from this server.
- `cs:` / `vs:` / `concept:` links resolve to the TermX web UI. The base is chosen in
  order: an explicit `site.web`, else the **tx-server's own web origin** (its URL with
  `/api/fhir` or `/fhir` stripped — so links follow the configured server), else the
  space's `web`. Set `site.web` to point links somewhere other than `tx-server`.

## To reach full parity later

1. **`{.dense}` on multimd tables** — pre-process the orphan marker onto the table element
   during staging (markdown-it-attrs can't attach it after the multimd token).
2. **Abbreviations** — add `markdown-it-abbr` to the markdown layer if any space uses `*[X]:`.
3. **Concept matrix columns** — the table shows `code`/`display`/`definition` and
   designation- or property-based columns; exotic property projections may need mapping.

## Where these are implemented in mdbook

- Markdown plugins: `src/markdown/` (`index.mjs`, `termx-links.mjs`, `termx-images.mjs`,
  `termx-embeds.mjs`, `collapsible.mjs`, `tabset.mjs`, `diagrams.mjs`)
- Build-time expansions: `src/ingest/` (`structure-definition.mjs`, `cards.mjs`,
  `sanitize.mjs`, `images.mjs`)
- Client runtime + styles: `src/theme/` (mermaid + `<tx-sd-view>` registration, `styles/smart-text.css`)
- Vendored viewer: `vendor/structure-definition-viewer/`
