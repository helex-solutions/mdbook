// mdbook default theme — extends VitePress's default theme and layers on
// skin palettes and smart-text styles. The active skin's CSS is imported by the
// generated staging theme file (see src/build.mjs), so this stays skin-agnostic.
import DefaultTheme from 'vitepress/theme'
import './styles/base.css'
import './styles/smart-text.css'

export default {
  extends: DefaultTheme
}
