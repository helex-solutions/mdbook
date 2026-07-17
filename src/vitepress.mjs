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
    outline: bundle.outline || [2, 3]
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
    markdown,
    // <tx-sd-view> is the vendored StructureDefinition viewer web component.
    vue: { template: { compilerOptions: { isCustomElement: (tag) => tag === 'tx-sd-view' } } }
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
