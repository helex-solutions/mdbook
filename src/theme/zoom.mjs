// Zoom control in the nav bar: − / level / +.
//
// Reference pages carry dense tables that are comfortable at different sizes
// depending on the screen — this scales the article (not the nav or sidebar, so
// the chrome stays put) and remembers the choice per browser. Clicking the
// percentage resets to 100%.
import { defineComponent, h, ref, onMounted } from 'vue'

const KEY = 'mdbook-zoom'
const MIN = 0.8
const MAX = 2
const STEP = 0.1

const clamp = (v) => Math.min(MAX, Math.max(MIN, Math.round(v * 10) / 10))

export default defineComponent({
  name: 'MdbookZoom',
  setup() {
    const level = ref(1)

    const apply = (v) => {
      level.value = v
      if (typeof document === 'undefined') return
      document.documentElement.style.setProperty('--mdbook-zoom', String(v))
      try {
        v === 1 ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, String(v))
      } catch {
        /* private mode / storage disabled — zoom still works for this page */
      }
    }

    onMounted(() => {
      let saved = null
      try {
        saved = localStorage.getItem(KEY)
      } catch {
        /* ignore */
      }
      const v = Number(saved)
      if (v && !Number.isNaN(v)) apply(clamp(v))
    })

    const btn = (label, title, onClick, disabled) =>
      h(
        'button',
        {
          class: 'mdbook-zoom-btn',
          type: 'button',
          title,
          'aria-label': title,
          disabled,
          onClick
        },
        label
      )

    return () =>
      h('div', { class: 'mdbook-zoom', role: 'group', 'aria-label': 'Zoom' }, [
        btn('−', 'Zoom out', () => apply(clamp(level.value - STEP)), level.value <= MIN),
        h(
          'button',
          {
            class: 'mdbook-zoom-level',
            type: 'button',
            title: 'Reset zoom to 100%',
            onClick: () => apply(1)
          },
          `${Math.round(level.value * 100)}%`
        ),
        btn('+', 'Zoom in', () => apply(clamp(level.value + STEP)), level.value >= MAX)
      ])
  }
})
