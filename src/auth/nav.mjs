// Pure navigation helpers shared by the theme. No framework imports — the theme
// component cannot be imported outside a VitePress client bundle, so anything
// worth testing lives here.

const AUTH_PAGES = /\/auth\/(signed-out|denied|login|logout|callback)\b/

// Where to land after signing in: back where the reader was, except on the
// generated auth pages — returning to "Signed out" right after signing in reads
// as a failed login.
export function returnToFor(base, loc) {
  if (!loc) return base
  return AUTH_PAGES.test(loc.pathname) ? base : loc.pathname + (loc.search || '')
}
