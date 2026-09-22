---
pdf: { orientation: landscape, margins: narrow, tables: fit }
---

# A wide reference table

Some pages are one wide table, and a portrait page cuts them off. This page sets
its own PDF layout in frontmatter, so exporting it gives a landscape sheet with
narrow margins and the table fitted to the width:

```yaml
---
pdf: { orientation: landscape, margins: narrow, tables: fit }
---
```

On screen the page is unaffected — the directives only reach the PDF.

| Module | Port | Owner | Purpose | Consumes | Consumed by | Status |
|---|---|---|---|---|---|---|
| fis | 18400 | platform | API gateway | every module | shell | live |
| mpi | 18401 | clinical | Master patient index | tx | pam, flow | live |
| md2pdf | 18509 | platform | HTML to PDF rendering | none | mdbook, wiki | new |
