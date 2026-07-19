// Turns a bullet list tagged `{.card-grid}` into a card grid — the same
// `.mdbook-card` markup produced from GitBook card tables (see
// `src/ingest/cards.mjs`), but authored as clean markdown and with support for
// explicit action **buttons** inside each card (which GitBook cards lack).
//
//   - ![](/.gitbook/assets/base.png)
//     ### LT Base
//     Core Lithuanian FHIR Implementation Guide with foundational profiles.
//     [Latest Build](https://build.fhir.org/ig/HL7LT/ig-lt-base){.button}
//     [History](https://hl7.lt/fhir/base/history.html){.button .secondary}
//   {.card-grid}
//
// Each top-level list item becomes one card:
//   first <img>              -> .mdbook-card-cover
//   first heading / <strong> -> .mdbook-card-title
//   links marked {.button}   -> .mdbook-card-buttons > a.mdbook-card-btn
//   everything else (text)   -> .mdbook-card-field (description)
//
// Extra classes on the list (e.g. `{.card-grid .cards-row}`) pass through to the
// wrapper, so skins/CSS can offer layout variants (a horizontal row, etc.).
//
// Runs as a core rule (after markdown-it-attrs, so the list carries `.card-grid`).
import { parse } from 'node-html-parser'

export function cardGrid(md) {
  md.core.ruler.push('mdbook_card_grid', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type !== 'bullet_list_open') continue
      if (!/\bcard-grid\b/.test(t.attrGet('class') || '')) continue

      // Find the matching bullet_list_close for this list.
      let depth = 0
      let closeIdx = i
      for (let j = i; j < tokens.length; j++) {
        if (tokens[j].type === 'bullet_list_open') depth++
        else if (tokens[j].type === 'bullet_list_close') {
          depth--
          if (depth === 0) {
            closeIdx = j
            break
          }
        }
      }

      try {
        const html = renderCardGrid(state, i, closeIdx)
        const tk = new state.Token('html_block', '', 0)
        tk.content = html
        tk.block = true
        tokens.splice(i, closeIdx - i + 1, tk) // i now points at the html_block
      } catch {
        // Never break the build over a malformed grid — leave the list as-is.
      }
    }
  })
}

function renderCardGrid(state, openIdx, closeIdx) {
  const tokens = state.tokens
  const md = state.md
  const listClass = tokens[openIdx].attrGet('class') || ''

  const cards = []
  let k = openIdx + 1
  while (k < closeIdx) {
    if (tokens[k].type !== 'list_item_open') {
      k++
      continue
    }
    // Find the matching list_item_close.
    let d = 0
    let end = k
    for (let m = k; m < closeIdx; m++) {
      if (tokens[m].type === 'list_item_open') d++
      else if (tokens[m].type === 'list_item_close') {
        d--
        if (d === 0) {
          end = m
          break
        }
      }
    }
    const itemTokens = tokens.slice(k + 1, end)
    const itemHtml = md.renderer.render(itemTokens, md.options, state.env)
    cards.push(renderCard(itemHtml))
    k = end + 1
  }

  // Carry any extra classes (besides card-grid) onto the wrapper.
  const extra = listClass
    .split(/\s+/)
    .filter((c) => c && c !== 'card-grid')
    .join(' ')
  const cls = 'mdbook-cards' + (extra ? ' ' + extra : '')
  return `<div class="${cls}">${cards.join('')}</div>`
}

// Normalize a relative asset path to a root-served path (mirrors cards.mjs), so
// raw-HTML <img> refs resolve from the mirrored public/ tree. Absolute/data URLs
// pass through untouched.
function assetUrl(src) {
  if (!src) return src
  if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) return src
  const clean = src.replace(/^(\.\.?\/)+/, '/')
  return clean.startsWith('/') ? clean : '/' + clean
}

// Collapse a fragment's paragraph wrappers into inline text (cards are compact).
function stripParagraphs(html) {
  return html
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/<\/p>\s*<p>/gi, '<br><br>')
    .replace(/<\/?p>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function attr(el, name) {
  const v = el.getAttribute(name)
  return v == null ? '' : v
}

function renderCard(itemHtml) {
  const root = parse(itemHtml)

  // Cover: first image.
  let cover = ''
  const img = root.querySelector('img')
  if (img) {
    const src = assetUrl(attr(img, 'src'))
    cover = `<img class="mdbook-card-cover" src="${src}" alt="${attr(img, 'alt')}" loading="lazy">`
    img.remove()
  }

  // Buttons: links carrying the `button` class.
  const buttons = []
  root.querySelectorAll('a').forEach((a) => {
    const cls = attr(a, 'class')
    if (!/\bbutton\b/.test(cls)) return
    const secondary = /\bsecondary\b/.test(cls) ? ' secondary' : ''
    const disabled = /\bdisabled\b/.test(cls) ? ' disabled' : ''
    const parts = [`href="${attr(a, 'href') || '#'}"`, `class="mdbook-card-btn${secondary}${disabled}"`]
    if (a.getAttribute('target')) parts.push(`target="${attr(a, 'target')}"`)
    if (a.getAttribute('rel')) parts.push(`rel="${attr(a, 'rel')}"`)
    buttons.push(`<a ${parts.join(' ')}>${a.innerHTML}</a>`)
    a.remove()
  })

  // Title: first heading, else first standalone <strong>.
  let title = ''
  const heading = root.querySelector('h1,h2,h3,h4,h5,h6')
  if (heading) {
    title = `<div class="mdbook-card-title">${heading.innerHTML}</div>`
    heading.remove()
  } else {
    const strong = root.querySelector('strong')
    if (strong) {
      title = `<div class="mdbook-card-title">${strong.innerHTML}</div>`
      strong.remove()
    }
  }

  // Description: whatever text remains.
  const descText = stripParagraphs(root.innerHTML)
  const desc = descText ? `<div class="mdbook-card-field">${descText}</div>` : ''
  const btns = buttons.length ? `<div class="mdbook-card-buttons">${buttons.join('')}</div>` : ''

  return `<div class="mdbook-card">${cover}<div class="mdbook-card-body">${title}${desc}${btns}</div></div>`
}
