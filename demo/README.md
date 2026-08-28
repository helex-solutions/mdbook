# mdbook demo

This site is built by **mdbook** from plain Markdown and served by `mdbook serve`
— the same binary that enforces its access control.

It exists to prove a deployment works end to end: content in a volume, one
generic container image, nginx in front, and an OpenID Connect gate in front of
part of the content.

## What to look at

- [Smart text](guide/smart-text.md) — callouts, tabsets, collapsibles, lists
- [Diagrams](guide/diagrams.md) — Mermaid and PlantUML rendered from fenced code
- [Code](guide/code.md) — Shiki highlighting and file-citing fences

Search (top right) indexes every page you are allowed to read.

## The part you cannot see

There is an **Internal** section on this site, and unless you are signed in with
the right role you will not find it: it is missing from the menu above, its
pages are absent from the search index, and asking for one by URL sends you to
the sign-in page rather than returning it.

That is the whole demonstration. The hiding is a courtesy — the enforcement is
in the server, which never sends a protected page to a reader who may not read
it. Follow [Internal](internal/README.md) to see what happens: sign in and the
section appears; sign in without the role and you get a refusal rather than the
content.

---

Served from a generic mdbook container with this project mounted at `/site`.
