# Code

Fenced blocks are highlighted by Shiki, with a copy button on hover.

```js
export function requirementFor(manifest, route) {
  if (!manifest) return 'public'
  return manifest.pages?.[route] ?? manifest.default
}
```

```bash
mdbook build --project .
mdbook serve --project . --port 8080
```

```yaml
site:
  title: mdbook demo
  base: /mdbook/
search: true
```
