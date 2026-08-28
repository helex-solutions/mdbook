# mdbook demo

This site is built by **mdbook** from plain Markdown and served by `mdbook serve`
— the same binary that enforces access control when a site is configured for it.

It exists to prove a deployment works end to end: content in a volume, one
generic container image, nginx in front.

## What to look at

- [Smart text](guide/smart-text.md) — callouts, tabsets, collapsibles, lists
- [Diagrams](guide/diagrams.md) — Mermaid and PlantUML rendered from fenced code
- [Code](guide/code.md) — Shiki highlighting and file-citing fences
- [Internal](internal/README.md) — the section that becomes access-controlled once
  an identity provider is configured

Search (top right) indexes every page on this site.

---

Served from a generic mdbook container with this project mounted at `/site`.
