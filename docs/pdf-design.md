# PDF export — design

How a reader turns a page (or a whole book) into a PDF, and why it is split
across two processes.

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

- **No cache.** Same reasoning as `OWLIKI.06` §2.7: a cache is a scaling decision
  that should follow evidence of a cost. The escalation path if one appears is a
  build-time pre-render into `dist`, not a second state store.
- **No build-time generation.** It would put Chromium in every CI run and in the
  GitHub Action, for artefacts most sites never fetch. The service is asked at
  the moment someone wants the file.
- **No branding beyond the ported themes.** The default is the site's own skin,
  printed. A deployment wanting something else picks a theme or sets `pdf.css`.
