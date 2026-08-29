// The pages `mdbook serve` shows instead of content: the 403 body, and the
// post-logout landing.
//
// They are self-contained — inline CSS, no scripts, no external assets —
// because of who receives them. Both are shown to someone the ACL is currently
// refusing: a reader with none of the required roles, or a reader who has just
// signed out and is therefore anonymous. On a site whose default access is a
// role (`access: [viewer]`), everything not explicitly public is refused to
// them, and that includes the theme bundle under /assets/. A page built from
// that bundle arrives with its stylesheet and scripts 403'd and renders as raw
// markup: headings as bare links, the theme's decorative SVG blown up to fill
// the viewport.
//
// Publishing /assets/ to fix that is not an option: VitePress emits one content
// chunk per page there (`architecture_compliance-requirements.md.<hash>.js`),
// so making the bundle public would publish every gated page with it.
//
// Hence: whatever these pages need, they carry.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
// `user` and `roles` come from token claims — attacker-influenced in principle,
// and interpolated into markup here.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

const list = (items) => items.map((r) => `<code>${esc(r)}</code>`).join(', ')

const withSlash = (base) => (base.endsWith('/') ? base : `${base}/`)

// One card, two accents: red for a refusal, neutral for a plain acknowledgement.
function shell({ title, siteTitle, accent = 'red', body, actions }) {
  const accents = { red: ['#cf222e', '#ff7b72'], neutral: ['#57606a', '#8b949e'] }
  const [light, dark] = accents[accent] || accents.red
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · ${esc(siteTitle)}</title>
<style>
  :root {
    --bg: #ffffff; --card: #ffffff; --fg: #1f2328; --muted: #656d76;
    --line: #d8dee4; --accent: ${light}; --code-bg: #f0f2f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --card: #161b22; --fg: #e6edf3; --muted: #9198a1;
      --line: #30363d; --accent: ${dark}; --code-bg: #21262d;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    background: var(--bg); color: var(--fg);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .card {
    width: 100%; max-width: 34rem;
    background: var(--card);
    border: 1px solid var(--line); border-radius: 10px;
    border-top: 4px solid var(--accent);
    padding: 28px 32px;
  }
  .site { font-size: 13px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
  h1 { margin: 6px 0 16px; font-size: 24px; line-height: 1.25; }
  p { margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: 14px; }
  code {
    background: var(--code-bg); border-radius: 4px;
    padding: 1px 6px; font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .actions { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--line); }
  .actions a { color: inherit; font-size: 14px; margin-right: 18px; }
</style>
</head>
<body>
  <main class="card">
    <div class="site">${esc(siteTitle)}</div>
    <h1>${esc(title)}</h1>
${body}
    <div class="actions">${actions}</div>
  </main>
</body>
</html>
`
}

// 'authenticated' | [role, …] -> a sentence fragment naming what was missing.
function requirementText(required) {
  if (Array.isArray(required) && required.length) {
    return required.length === 1
      ? `This page requires the ${list(required)} role.`
      : `This page requires one of these roles: ${list(required)}.`
  }
  return 'This page requires an account with access.'
}

export function deniedPageHtml({
  siteTitle = 'Documentation',
  base = '/',
  user = null,
  roles = [],
  required = null,
  // Whether this reader may read the site root. On a site that is gated in its
  // entirety (`access: [viewer]` and no public section) the root is denied too,
  // so a "Back to the site" link would land right back here — a link that looks
  // broken because it goes nowhere. Offered only when it actually leads out.
  homeAllowed = true
} = {}) {
  const b = withSlash(base)
  const held = roles.length
    ? `Your account holds ${list(roles)}.`
    : 'Your account holds no roles on this site yet.'

  return shell({
    title: 'Access denied',
    siteTitle,
    accent: 'red',
    body: `    <p>You are signed in${user ? ` as <strong>${esc(user)}</strong>` : ''}, but not permitted to read this page.</p>
    <p class="muted">${requirementText(required)} ${held}</p>
    <p class="muted">
      Signing in proves who you are; reading requires a role on top of that.
      If you should have access, ask an administrator to grant it — then reload
      this page.
    </p>`,
    actions:
      (homeAllowed ? `\n      <a href="${esc(b)}">Back to the site</a>` : '') +
      `\n      <a href="${esc(b)}auth/logout">Sign in as someone else</a>\n    `
  })
}

export function signedOutPageHtml({ siteTitle = 'Documentation', base = '/' } = {}) {
  const b = withSlash(base)
  return shell({
    title: 'Signed out',
    siteTitle,
    accent: 'neutral',
    body: `    <p>You have been signed out.</p>
    <p class="muted">
      Your session on this site has ended. Signing in again will ask the identity
      provider for a fresh login.
    </p>`,
    actions: `\n      <a href="${esc(b)}auth/login">Sign in again</a>\n    `
  })
}
