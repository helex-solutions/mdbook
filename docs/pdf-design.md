# PDF export — design

How a reader turns a page — or a section with its subpages, or a whole book —
into a PDF, and why it is split across two processes.

This mirrors the wiki's own export design (helex-tx `OWLIKI.06`) rather than
inventing a second one. The load-bearing rule is carried over verbatim:

> **One markdown → HTML path; PDF is the last step only** — so what a reader
> reads and what gets filed cannot diverge.

In the wiki that meant `markdown → commonmark → HTML → Flying Saucer → PDF`
inside one Java process. mdbook has no such process: it is a static generator
whose HTML is produced once, at build time, by VitePress. So the pipeline is the
same shape with the front half already done:

```
built page (dist/**.html)          ← the HTML the reader is actually served
  → extract the article            (src/pdf/document.mjs)
  → assemble ONE self-contained document: print stylesheet inlined,
    images inlined as data: URIs, heading numbering, optional title page + TOC
  → POST to md2pdf                 (src/pdf/client.mjs)
  → Chromium print-to-PDF          (md2pdf/render.mjs)
```

Nothing re-renders markdown. The PDF is made from the same bytes the browser
got, which is what the rule above asks for.

## 1. Why a separate service

A PDF needs a layout engine. The three ways to get one are a bundled browser
(~400 MB), a Python paged-media renderer (WeasyPrint — no JavaScript, so no
Mermaid), or a Java one (the wiki's choice, not available here).

mdbook's runtime image is deliberately small — `node:22-alpine`, no browser —
and one image serves every installation. Putting Chromium in it would make every
deployment pay for a feature most do not enable.

So the renderer is its own image (`md2pdf/`), added to a deployment only when the
feature is wanted, and **PDF is off unless it is configured**. This is the same
rule `diagrams.plantumlServer` already follows: an unset server means the feature
does not exist for that site, rather than a default endpoint nobody chose.

It lives in its own repository, `helex-solutions/md2pdf`, because a second
consumer is expected: the wiki's own export (`OWLIKI.06`) is to be migrated onto
the same service, dropping Flying Saucer/OpenPDF, the `owliki.export.font-path`
handling and the server-side `{{token}}` substitution that only exists because
Flying Saucer speaks CSS 2.1. The contract in §3 is designed to take that caller
unchanged — `WikiExportService.wrap()` already produces a complete, self-contained
styled document, which is exactly what `POST /pdf` wants.

**Port 18509.** The tx/emr ecosystems allocate from `emr-repo`
`docs/development/port-map.md`: 184xx backend services, **185xx infrastructure**,
186xx frontend dev servers. md2pdf is shared infrastructure, so it takes the next
free slot in the 18509-18549 range that map reserves for it.

## 2. Who calls whom

```
browser ──GET {base}pdf?path=…&scope=…──► mdbook serve ──POST /pdf──► md2pdf
        ◄──────── application/pdf ────────             ◄── PDF ──────
```

**The browser never talks to md2pdf.** Three reasons, in order of weight:

1. **Access control.** `mdbook serve` already resolves `acl.json` for every
   route. Routing the export through it means a reader cannot export a page they
   cannot read, and a whole-book export contains exactly the pages *that reader*
   may see — the wiki's rule (`OWLIKI.06` §2.1), enforced the same way.
2. **No client-supplied HTML.** `OWLIKI.06` §2.2 explicitly rejected "render in
   the browser and POST the HTML back", because it feeds caller-controlled markup
   into a document pipeline. Here the HTML is read off disk from mdbook's own
   `dist/`, so the only thing the browser supplies is a path.
3. **The service stays private.** It needs no public route, no CORS, and on a
   compose network no published port at all.

The export is a `GET`: it is a read-only projection, so it is a plain link that
can be right-clicked, bookmarked and re-fetched — and it carries the session
cookie the reader already has.

### What this means for a statically hosted site

A site on GitHub Pages has no `mdbook serve`, so it has no `/pdf` route and the
button does not appear. That is the honest outcome rather than a broken button:
the feature is a property of the deployment, not of the content. Such a site
still prints well — `print.css` (§5) is part of the theme and applies to an
ordinary Ctrl-P.

## 3. The contract

`md2pdf` is a plain HTTP service. It knows nothing about mdbook beyond the two
placeholder conventions in §3.3.

### 3.1 `GET /health`

```json
{ "status": "ok", "engine": "chromium", "version": "141.0.7390.54", "busy": 0, "concurrency": 2 }
```

Answers 200 when a browser can be launched, 503 when it cannot. `mdbook serve`
does not poll it; it is for a container healthcheck.

### 3.2 `POST /pdf`

Request — `application/json`:

| Field | Type | Meaning |
|---|---|---|
| `html` | string, required | a complete, self-contained HTML document |
| `filename` | string | used for `Content-Disposition` on the way back |
| `options.format` | string | `A4` (default), `Letter`, … |
| `options.landscape` | boolean | default `false` |
| `options.margin` | `{top,right,bottom,left}` | CSS lengths; default `18mm`/`16mm` |
| `options.scale` | number | 0.1–2, default `1` |
| `options.printBackground` | boolean | default `true` — callout tints and table header fills are meaning, not decoration |
| `options.theme` | string | a name from `GET /themes` (§3.3a); `site` (default) applies none |
| `options.css` | string | extra CSS, appended after the theme's |
| `options.logo` | string | a `data:` image URI for the theme's title block |
| `options.headerTemplate` / `options.footerTemplate` | string | Chromium header/footer HTML; mdbook sends a footer carrying the page number and the site title |
| `options.timeout` | number | ms, clamped to the service's own ceiling |

Response: `application/pdf`, or `application/json` `{ "error": "…" }` with 400
(malformed request), 413 (body over the limit), 429 (all render slots busy),
500 (render failed), 503 (no browser).

Authentication: if `MD2PDF_TOKEN` is set, every request must carry
`Authorization: Bearer <token>`; otherwise the service is open to whoever can
reach it, which on a compose network is the intended posture.

### 3.3a Themes

`GET /themes` lists them; `options.theme` picks one. The service ships `helex`
and `helex-onepager` — ports of the `--format` presets of `~/bin/md2pdf.sh` —
plus `plain` and the default `site`, which applies none because the caller's
document is already styled.

**Only themes that project owns are bundled.** One carrying another
organisation's visual identity is mounted at run time via `MD2PDF_THEMES_DIR`
instead: a wordmark, a palette taken from a brand manual and a postal address are
that organisation's, and a public image containing one would let anyone render a
document that looks as though it came from them. A mounted theme may also share a
name with a bundled one and win, which is how a deployment adjusts a shipped
theme without forking the image.

**The port is a translation, and two of its steps are worth recording because
both failed silently.** The source sheets target WeasyPrint:

- Their running headers, footers and page numbers are `@page` **margin boxes**
  (`@bottom-right { content: "Page " counter(page) … }`). Chromium has none of
  that, so each theme's margin-box content is re-authored as `header.html` /
  `footer.html` and driven by `displayHeaderFooter`. Ported verbatim, the PDF
  still renders — it has simply lost its brand band and page numbers.
- `@font-face { src: local(…) }` resolves against installed fonts in WeasyPrint.
  Chromium cannot, and because the rule still *defines* the family, a failed
  match drops to the generic default rather than falling through the family
  stack: the whole HELEX document came out in Times. Removing the rule leaves
  the stack to say what it meant.

A third trap is in the porting tool rather than the themes: `md2pdf-helex.css`
mentions "`@page` borders" **inside a comment**, and a scanner that matched it
consumed forward to the next braced block, deleting the `html, body` typography
rule. Comments are masked before scanning; `tools/port-themes.mjs` carries all
three.

Logos are not in the image — the Tervisekassa mark is a trademark needing that
body's approval — so a theme takes `options.logo` as a `data:` URI and otherwise
keeps its typographic mark.

### 3.3 What the service does to the document

Two conventions, and nothing else — they are the only mdbook-shaped knowledge it
has, and both are named here so the coupling is visible:

- **`.mermaid-diagram[data-src]`** — mdbook's markdown layer emits Mermaid as a
  placeholder carrying URI-encoded source, drawn client-side by the theme. The
  service draws them with its own bundled Mermaid, using the same two safety
  settings the theme states (`securityLevel: 'strict'`, `htmlLabels: false`), so
  a diagram cannot be a way to make the renderer do something else.
- **`.mdbook-pdf-frame`** — an inline PDF preview iframe (`{% file %}`). It
  cannot be printed, so it is replaced by a link to the file.

### 3.4 Network posture — the service fetches nothing

The rendered document is loaded with `setContent`, and **every network request
the page makes is aborted** except `data:`. Page content is authored by whoever
writes the wiki, so an `<img src="http://…">` in a page must not become a fetch
made by the renderer from inside the deployment's network. That is why §4 inlines
assets instead of leaving URLs for the renderer to resolve: by the time the HTML
reaches Chromium there is nothing left to fetch, so cutting the network costs
nothing and closes SSRF.

The browser also runs with no shared filesystem, one context per request, and a
hard render timeout.

## 4. Assembling the document (`src/pdf/document.mjs`)

Given a built `dist` and a route:

1. **Extract** `.vp-doc` from the page's HTML with `node-html-parser` (already a
   dependency). Chrome, sidebar, nav, breadcrumbs, comments and the "on this
   page" aside are not part of the document.
2. **Strip** what cannot be printed or means nothing on paper: header anchors,
   the zoom/present/PDF controls, `<script>`, the try-it console's inputs.
3. **Open** every `<details>`, so a collapsed section is in the document rather
   than silently missing from it — the same reason `OWLIKI.06` lists omitted
   pages instead of dropping them.
4. **Number** headings when `numbered` is on: `1.`, `1.1`, `1.1.1` prefixed
   **into the heading text**, not as CSS counters, so the numbers survive
   copy-paste and PDF text extraction. A heading that already starts with a
   number-like token is left alone. This is `OWLIKI.06` §2.5, unchanged.
5. **Inline** images from `dist` as `data:` URIs, and the print stylesheet as a
   `<style>`. The result has no external references (§3.4).
6. **Wrap** in a document with the page title, and for a book export a title page
   and a table of contents generated from the same numbering pass, so numbers and
   TOC cannot disagree.

**Per-page directives.** A page may set `pdf: { orientation, margins, scale,
tables }` in frontmatter — the directives of `~/bin/md2pdf.sh`, in mdbook's
idiom. They travel to the export as a `<meta name="mdbook-pdf">` tag, because the
export reads `dist/**.html` and never sees the staged markdown. Page scope only:
in a book a dozen pages would each claim a different page box, and letting the
last one read win silently is worse than ignoring all of them.

Book scope walks the resolved sidebar order — the order the menu shows — and
skips pages the caller may not read, listing them at the end the way the wiki
lists pages omitted for language. A silent gap makes a document that looks
complete and is not.

### 4.1 Subpages scope

Between one page and the whole site is the document people actually ask for: a
chapter, a handbook section, one subsystem's reference — the page they are on,
with everything filed under it.

**Membership is the menu, not the filesystem.** `pdf-manifest.json` therefore
records each page's `parent` — its parent in the resolved sidebar — and the
subtree is the transitive closure over those links (`subtreePages()`), emitted in
manifest order. Route-prefix matching was the obvious alternative and is wrong
for the case that matters: a `SUMMARY.md` may file a page under a chapter whose
path it does not share, and the reader's claim on the document is the menu they
navigated. A manifest written before `parent` existed has none, and membership
falls back to the route prefix — a stale `dist` gives a coarser document rather
than an empty one.

Two consequences of recording the parent are worth stating, because both were
bugs first:

- In the folder-tree layout a section's sidebar is an entry **keyed by** the
  landing page, not nested under it. Read naively, every section's pages come out
  parentless and a subpages export from a landing page finds no children at all.
  `flattenSidebar()` passes the section key down as the parent for that walk.
- The landing page is also the one entry that is always a **duplicate** (the root
  sidebar links into the section; the section's own sidebar repeats it). So the
  parent handed to its children is set from the entry that was *walked*, not from
  the entry that was *pushed* — the push is skipped by the dedupe.

A page at the top level has no parent, so its parent is taken to be the site
root. That makes a subpages export asked from the home page the whole menu,
which is the book — the honest answer rather than one lonely page.

**One page is a page.** Asked from a leaf, the scope produces exactly what page
scope produces: no cover, no one-line table of contents, no `1.` in front of the
only `h1`, and that page's own layout directives honoured (§4's directives are
page-scope only because a *collection* cannot honour twelve of them — a
collection of one can). The alternative is a control that fails on leaf pages,
and a reader cannot tell a leaf from a branch before clicking.

**The page it is asked from is ACL-checked on its own, first**, so a reader who
may not open it gets the same 403 — and the same login redirect — that page scope
gives, rather than a document of that page's children.

### 4.2 Size — why an export can be refused

A multi-page export is assembled **in the serving process**, and that process
serves everybody. Three copies of the same bytes exist before Chromium lays out
a single page: the sections as they accumulate, the string `assemble()` joins
them into, and the JSON body `client.mjs` encodes for md2pdf. A fourth lives in
md2pdf itself.

Measured here, on real sites, with the export path itself rather than a model:

| site | pages | sections | mean | peak RSS |
|---|---|---|---|---|
| a tutorial site | 80 | 26.5 MB | 339 KB/page | 523 MB |
| a registry site | 18 | 7.7 MB | 437 KB/page | 165 MB |
| the manuals site | 317 | 9.9 MB | 31 KB/page | — |

Two things in the first two rows set the design. A page that carries images is
**hundreds of kilobytes**, not tens, because §4 inlines them as `data:` URIs —
the thing that makes the document self-contained is also what makes it heavy. And peak RSS runs an
**order of magnitude above the bytes**, because every page is parsed into a DOM
on the way through. A document is far more expensive than its own size.

The third row is the counter-case, and it is why there are two ceilings rather
than one. Its pages are prose, so they run an order of magnitude lighter, and
the **whole 317-page menu** assembles into 9.9 MB — comfortably under the byte
ceiling, and refused only by the page one. Neither number on its own describes
an export.

Extrapolating the first row to the 2422-page site this project also serves gives
roughly 800 MB of sections before the join. That is not a slow download: the
deployment measured it as `FATAL ERROR ... JavaScript heap out of memory` after
74 seconds, and because the container restarts, **one reader pressing the button
is an outage for everyone**. That is the failure being fenced.

**Refused, not narrowed.** An export over the ceiling answers `413` with the
numbers in it. Quietly dropping pages to fit would produce a document that looks
complete and is not — the rule §4 already follows for pages a reader may not
read, and for collapsed `<details>`.

**Two ceilings, because they fail differently.**

- `pdf.maxPages` (default 200) is checked **before a single page is read**. The
  count is known from the manifest, so the document that would kill the process
  is never started, and the refusal costs nothing.
- `pdf.maxBytes` (default 32 MB) is checked **as the sections accumulate**, and
  stops at the page that crosses it. This is the one that actually stands
  between a site and the heap, because page count is a poor proxy for weight: a
  hundred screenshot-heavy pages outweigh a thousand plain ones.

Both count only the pages **this reader may open**, because the ACL runs first.
A gated site does not refuse a reader whose own document is small, and a reader
cannot spend the server's memory on pages they cannot read. `0` disables either
one, deliberately, the way `scope: []` is a deliberate off switch: a deployment
that has measured its own site may say so, but it has to say so.

**Book scope is guarded too**, for the same reason it needs guarding: it is the
same assembly. Until now a large site avoided the failure only by not offering
the button, which protected the site but left the failure one config edit away.

### 4.3 Why not stream instead

The honest answer is that streaming is not available here, and the reason is in
the contract rather than in this code.

`POST /pdf` takes **one** self-contained document and renders it with
`setContent` (§3.2, §3.4). Chunking the upload would remove mdbook's JSON copy
and nothing else: Chromium would still hold the whole document, still lay it out
in one pass, and the 60s render timeout would still be the ceiling for a book.

What would actually remove the ceiling is md2pdf growing a **merge**: render N
bounded documents and concatenate the PDFs. Then neither process ever holds the
whole book, and the limit becomes disk rather than heap. It is a real design,
and it is md2pdf's to make — with two consequences that belong in its design
rather than this one: page numbering and the table of contents have to be
resolved across chunks, which means either a numbering pass before rendering or
a post-pass over the merged file.

So the ceiling here is a fence, not a fix, and it is named as one. The
deployments that read "restore it when a book export streams" now have an
answer: that work is in md2pdf, and until it exists, a section is the document
that fits.

## 5. `print.css`

One stylesheet, used twice: by Chromium inside md2pdf, and by a reader pressing
Ctrl-P on the live site. It is part of the theme, so a site with no md2pdf still
gets the benefit.

It sets `@page` **margins but deliberately not `size`** — `@page { size: A4 }`
overrides Chromium's own paper settings, so a page asking for landscape came out
portrait A4 with no error anywhere; and for a reader pressing Ctrl-P the paper is
theirs to choose. md2pdf owns the page box, this owns the margins inside it.
It also forces the light palette (a dark-theme reader
printing white-on-black wastes toner and reads badly), repeats table headers
across page breaks, keeps headings with the text that follows them, avoids breaks
inside code blocks, callouts and figures, and prints the URL after an external
link — a paper document with unfollowable links is the common failure.

## 6. Deliberately absent

- **No per-page "download this section" link in the body.** The nav-bar control
  already knows which page it is on, and a second entry point would have to be
  kept in step with the ACL at render time rather than at request time.
- **No cache.** Same reasoning as `OWLIKI.06` §2.7: a cache is a scaling decision
  that should follow evidence of a cost. The escalation path if one appears is a
  build-time pre-render into `dist`, not a second state store.
- **No build-time generation.** It would put Chromium in every CI run and in the
  GitHub Action, for artefacts most sites never fetch. The service is asked at
  the moment someone wants the file.
- **No branding beyond the ported themes.** The default is the site's own skin,
  printed. A deployment wanting something else picks a theme or sets `pdf.css`.
