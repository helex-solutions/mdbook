// The 403 body, as a self-contained HTML document.
//
// It has to be self-contained — inline CSS, no scripts, no external assets —
// because of who receives it. A reader who is signed in but holds none of the
// required roles is denied everything the ACL protects, and on a site whose
// default access is a role (`access: [viewer]`) that includes the theme bundle
// under /assets/. So the obvious implementation — a normal built page — arrives
// at the browser with its stylesheet and scripts 403'd and renders as raw
// markup: headings as bare links, the theme's decorative SVG blown up to fill
// the viewport.
//
// Publishing /assets/ to fix that is not an option: VitePress emits one content
// chunk per page there (`architecture_compliance-requirements.md.<hash>.js`),
// so making the bundle public would publish every gated page with it.
//
// Hence: whatever this page needs, it carries.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
// `user` and `roles` come from token claims — attacker-influenced in principle,
// and interpolated into markup here.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])

const list = (items) => items.map((r) => `<code>${esc(r)}</code>`).join(', ')

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
  required = null
} = {}) {
  const b = base.endsWith('/') ? base : `${base}/`
  const held = roles.length
    ? `Your account holds ${list(roles)}.`
    : 'Your account holds no roles on this site yet.'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Access denied · ${esc(siteTitle)}</title>
<style>
  :root {
    --bg: #ffffff; --card: #ffffff; --fg: #1f2328; --muted: #656d76;
    --line: #d8dee4; --accent: #cf222e; --code-bg: #f0f2f5;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --card: #161b22; --fg: #e6edf3; --muted: #9198a1;
      --line: #30363d; --accent: #ff7b72; --code-bg: #21262d;
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
    <h1>Access denied</h1>
    <p>You are signed in${user ? ` as <strong>${esc(user)}</strong>` : ''}, but not permitted to read this page.</p>
    <p class="muted">${requirementText(required)} ${held}</p>
    <p class="muted">
      Signing in proves who you are; reading requires a role on top of that.
      If you should have access, ask an administrator to grant it — then reload
      this page.
    </p>
    <div class="actions">
      <a href="${esc(b)}">Back to the site</a>
      <a href="${esc(b)}auth/logout">Sign in as someone else</a>
    </div>
  </main>
</body>
</html>
`
}
