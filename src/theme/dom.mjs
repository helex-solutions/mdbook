// Minimal element builder shared by the theme's imperative islands.
//
// These islands live inside already-rendered markdown, so they are built with
// plain DOM rather than a Vue template — that avoids re-parsing user content as
// a template, and keeps the pieces importable (and testable) without Vue.
export const el = (tag, props = {}, children = []) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v != null) n.setAttribute(k, v)
  }
  for (const c of [].concat(children)) n.append(c)
  return n
}
