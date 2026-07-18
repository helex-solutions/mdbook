// Builds a VitePress user-config object from mdbook's normalized site bundle.
// Called by the generated staging `.vitepress/config.mjs`.
import { applyMarkdown } from './markdown/index.mjs'

// Merge the auto-generated sidebar with user overrides/extensions from .mdbook.
function resolveSidebar(generated, userSidebar, userExtra) {
  if (userSidebar) return userSidebar // full override
  return [...(generated || []), ...(userExtra || [])]
}

function resolveNav(generated, userNav) {
  return [...(generated || []), ...(userNav || [])]
}

function themeConfigFor(bundle, lang) {
  return {
    nav: resolveNav(bundle.navs?.[lang], bundle.userNav),
    sidebar: resolveSidebar(bundle.sidebars?.[lang], bundle.userSidebar, bundle.userSidebarExtra),
    ...(bundle.search ? { search: { provider: 'local' } } : {}),
    ...(bundle.logo ? { logo: bundle.logo } : {}),
    ...(bundle.comments ? { comments: bundle.comments } : {}),
    outline: bundle.outline || [2, 3]
  }
}

// The route path for a page (base-less), matching VitePress' own sitemap logic.
export function routeFor(relativePath, cleanUrls) {
  return (relativePath || '')
    .replace(/(^|\/)index\.md$/, '$1')
    .replace(/\.md$/, cleanUrls ? '' : '.html')
}

// Resolve an image path/URL to an absolute URL (needs the site URL for
// site-relative paths). Returns null if it can't be made absolute.
export function absImage(image, siteUrl) {
  if (!image) return null
  if (/^https?:\/\//i.test(image)) return image
  return siteUrl ? new URL(String(image).replace(/^\//, ''), siteUrl).toString() : null
}

// Per-page Open Graph / Twitter / canonical / JSON-LD tags. Runs as a VitePress
// build hook so each page carries its own title, description, image and (when the
// canonical site URL is known) absolute URL.
function seoHead(bundle) {
  const { siteUrl, title: siteName, description: siteDesc, cleanUrls, defaultLang } = bundle
  const imageUrl = absImage(bundle.image, siteUrl)
  return (ctx) => {
    const pd = ctx.pageData || {}
    const title = pd.title || ctx.title || siteName
    const description = pd.description || ctx.description || siteDesc || ''
    const isHome = (pd.relativePath || '').replace(/(^|\/)index\.md$/, '$1') === ''
    const url = siteUrl ? new URL(routeFor(pd.relativePath, cleanUrls ?? true), siteUrl).toString() : null
    const tags = [
      ['meta', { property: 'og:type', content: isHome ? 'website' : 'article' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:site_name', content: siteName }],
      ['meta', { name: 'twitter:card', content: imageUrl ? 'summary_large_image' : 'summary' }],
      ['meta', { name: 'twitter:title', content: title }]
    ]
    if (description) {
      tags.push(['meta', { property: 'og:description', content: description }])
      tags.push(['meta', { name: 'twitter:description', content: description }])
    }
    if (imageUrl) {
      tags.push(['meta', { property: 'og:image', content: imageUrl }])
      tags.push(['meta', { name: 'twitter:image', content: imageUrl }])
    }
    if (url) {
      tags.push(['meta', { property: 'og:url', content: url }])
      tags.push(['link', { rel: 'canonical', href: url }])
    }
    // Stable TermX identifiers (space + page code) for downstream tooling.
    if (bundle.spaceCode) tags.push(['meta', { name: 'termx:space', content: bundle.spaceCode }])
    if (pd.frontmatter?.termxPage) tags.push(['meta', { name: 'termx:page', content: pd.frontmatter.termxPage }])
    // JSON-LD structured data (WebSite on the home page, TechArticle elsewhere).
    const lang = pd.frontmatter?.lang || defaultLang || 'en'
    const ld = isHome
      ? { '@context': 'https://schema.org', '@type': 'WebSite', name: siteName, inLanguage: lang, ...(siteUrl ? { url: siteUrl } : {}), ...(siteDesc ? { description: siteDesc } : {}) }
      : {
          '@context': 'https://schema.org',
          '@type': 'TechArticle',
          headline: title,
          inLanguage: lang,
          ...(description ? { description } : {}),
          ...(url ? { url } : {}),
          ...(imageUrl ? { image: imageUrl } : {}),
          isPartOf: { '@type': 'WebSite', name: siteName, ...(siteUrl ? { url: siteUrl } : {}) }
        }
    tags.push(['script', { type: 'application/ld+json' }, JSON.stringify(ld)])
    return tags
  }
}

export function createMdbookConfig(bundle) {
  const { defaultLang, langs = [defaultLang], spaceNames = {} } = bundle

  const markdown = {
    // TermX Wiki renders single newlines as <br> (markdown-it breaks:true).
    breaks: bundle.breaks ?? false,
    config: (md) =>
      applyMarkdown(md, {
        web: bundle.web,
        txServer: bundle.txServer,
        spaceCode: bundle.spaceCode,
        pageSlugs: bundle.pageSlugs,
        assetBase: bundle.assetBase || '/attachments'
        // langPrefix is applied per-locale below via separate md instances is not
        // possible in VitePress (single md), so page: links resolve to root-relative;
        // acceptable because slugs are unique per space.
      }),
    lineNumbers: bundle.lineNumbers ?? false
  }

  const base = {
    title: bundle.title,
    description: bundle.description || '',
    base: bundle.base || '/',
    ...(bundle.outDir ? { outDir: bundle.outDir } : {}),
    cleanUrls: bundle.cleanUrls ?? true,
    ignoreDeadLinks: true,
    lastUpdated: true,
    // SEO: sitemap.xml (when the canonical URL is known) + per-page OG tags.
    ...(bundle.siteUrl ? { sitemap: { hostname: bundle.siteUrl } } : {}),
    transformHead: seoHead(bundle),
    markdown,
    // <tx-sd-view> is the vendored StructureDefinition viewer web component.
    vue: { template: { compilerOptions: { isCustomElement: (tag) => tag === 'tx-sd-view' } } },
    // Don't watch mdbook's own source as config deps — editing the tool while a
    // project dev server runs would otherwise restart it (Shiki-dispose race).
    ...(bundle.mdbookDir
      ? { vite: { server: { watch: { ignored: [`${bundle.mdbookDir}/**`] } } } }
      : {})
  }

  // Single language: flat config. Multiple: VitePress `locales`.
  if (langs.length <= 1) {
    return {
      ...base,
      lang: defaultLang,
      themeConfig: themeConfigFor(bundle, defaultLang)
    }
  }

  const locales = {}
  for (const lang of langs) {
    const isDefault = lang === defaultLang
    locales[isDefault ? 'root' : lang] = {
      label: spaceNames[lang] || lang.toUpperCase(),
      lang,
      ...(isDefault ? {} : { link: `/${lang}/` }),
      themeConfig: themeConfigFor(bundle, lang)
    }
  }
  // Top-level themeConfig carries locale-independent settings (search index is
  // built once, across all locales).
  const themeConfig = bundle.search ? { search: { provider: 'local' } } : {}
  return { ...base, themeConfig, locales }
}
