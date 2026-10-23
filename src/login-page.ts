/**
 * Self-contained HTML pages (inline CSS + JS, string-template style — no
 * template engine): the login form and the first-time setup form. No external
 * assets. Visual identity: a split screen — left, the dark DSH side (plugin
 * board backdrop, brand, the "everything is a plugin" story with a feature
 * grid, loaded badge); right, a light card holding the form. On phones the
 * dark side shrinks to a compact brand header and the form rises over it as a
 * sheet, so signing in never needs a scroll; the feature story folds into a
 * "What is dsh-login?" disclosure inside the card. User management ships
 * inside the GUI settings panel (Settings → Users) via the browser bundle,
 * not here.
 */

/**
 * Plugin board ambience: tiles are laid out inside the dark pane by inline
 * JS (snapped to the grid).
 */
const BOARD_JS = `
    (function () {
      var reduce = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var board = document.getElementById('board');
      var pane = document.getElementById('paneDark');
      var CELL = 72, SIZE = 56;

      function layout() {
        board.innerHTML = '';
        var W = pane.clientWidth, H = pane.clientHeight;
        var cols = Math.ceil(W / CELL);
        var rows = Math.ceil(H / CELL);
        var count = Math.min(18, Math.max(8, Math.round(cols * rows * 0.04)));
        var picks = {};
        var placed = 0, guard = 0;
        while (placed < count && guard++ < cols * rows * 4) {
          var c = Math.floor(Math.random() * cols);
          var r = Math.floor(Math.random() * rows);
          var x = c * CELL + (CELL - SIZE) / 2;
          var y = r * CELL + (CELL - SIZE) / 2;
          // keep the space behind the text block clean
          if (x < 600 && y > H * 0.08 && y < H * 0.92) continue;
          var key = c + ':' + r;
          if (picks[key]) continue;
          picks[key] = true;
          var t = document.createElement('div');
          t.className = 'tile' + (Math.random() < 0.35 ? ' tile--lit' : '');
          t.style.left = x + 'px';
          t.style.top = y + 'px';
          t.style.setProperty('--d', (placed * 45) + 'ms');
          if (!reduce && Math.random() < 0.4) {
            t.style.setProperty('--breath-delay', (6 + Math.random() * 16) + 's');
          }
          board.appendChild(t);
          placed++;
        }
      }

      var tm;
      window.addEventListener('resize', function () {
        clearTimeout(tm);
        tm = setTimeout(layout, 200);
      });
      layout();
    })();
`

/**
 * Shared form behaviour: show/hide password buttons, and autofocus only on
 * wide screens (on a phone it would pop the keyboard over the page).
 */
const FORM_JS = `
    (function () {
      var reveals = document.querySelectorAll('[data-reveal]');
      Array.prototype.forEach.call(reveals, function (btn) {
        btn.addEventListener('click', function () {
          var ids = btn.getAttribute('data-reveal').split(' ');
          var show = btn.getAttribute('aria-pressed') !== 'true';
          ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.type = show ? 'text' : 'password';
          });
          btn.setAttribute('aria-pressed', show ? 'true' : 'false');
          btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
          btn.textContent = show ? 'Hide' : 'Show';
        });
      });
      if (window.matchMedia && window.matchMedia('(min-width: 881px)').matches) {
        var first = document.getElementById('username');
        if (first) first.focus();
      }
    })();
`

const BASE_CSS = `
    :root {
      --bg: #0f1420;
      --panel: #151b2c;
      --inset: #0d1220;
      --line: #262f47;
      --line-soft: #1c2438;
      --text: #e8ebf4;
      --muted: #a9b2c7;
      --faint: #8a93ab;
      --accent: #6f9bff;
      --accent-strong: #3f6fe0;
      --accent-strong-hover: #2f5fd0;
      --accent-soft: rgba(111, 155, 255, 0.14);
      --ring: rgba(111, 155, 255, 0.24);
      --ok: #46d19a;
      --lt-bg: #f3f5fa;
      --lt-card: #ffffff;
      --lt-line: #e1e6f1;
      --lt-field: #d5dbe8;
      --lt-inset: #f6f8fc;
      --lt-text: #1d2536;
      --lt-muted: #5d6782;
      --lt-faint: #67718c;
      --danger: #d64545;
      --danger-bg: #fdecec;
      --danger-line: #f3c4c4;
      --danger-text: #8f2323;
      --match: #237a57;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      min-height: 100vh;
      min-height: 100dvh;
      -webkit-text-size-adjust: 100%;
    }

    .split {
      display: flex;
      min-height: 100vh;
      min-height: 100dvh;
    }
    .pane { flex: 1 1 50%; position: relative; }

    /* ---- left: the dark DSH side ---- */
    .pane--dark {
      flex-basis: 52%;
      background: var(--bg);
      overflow: hidden;
    }
    .board-bg {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(var(--line-soft) 1px, transparent 1px),
        linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
      background-size: 72px 72px;
      opacity: 0.35;
    }
    .board-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(
        ellipse 90% 80% at 30% 50%,
        transparent 30%, var(--bg) 100%
      );
    }
    #board { position: absolute; inset: 0; pointer-events: none; }
    .tile {
      position: absolute;
      width: 56px;
      height: 56px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(21, 27, 44, 0.55);
      opacity: 0;
      animation: tileIn 0.6s ease both;
      animation-delay: var(--d, 0ms);
    }
    .tile--lit {
      border-color: rgba(111, 155, 255, 0.45);
      background: var(--accent-soft);
      animation: tileIn 0.6s ease both, breath 7s ease-in-out infinite;
      animation-delay: var(--d, 0ms), var(--breath-delay, 4s);
    }
    .tile--lit::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 6px;
      height: 6px;
      margin: -3px 0 0 -3px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.8;
    }
    @keyframes tileIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 0.9; transform: none; }
    }
    @keyframes breath {
      0%, 100% { box-shadow: 0 0 0 0 rgba(111, 155, 255, 0); }
      50% { box-shadow: 0 0 22px 0 rgba(111, 155, 255, 0.16); }
    }

    .pane-content {
      position: relative;
      height: 100%;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 48px;
      padding: 64px 72px;
      max-width: 664px;
      animation: rise 0.55s cubic-bezier(0.22, 0.8, 0.36, 1) both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: none; }
    }

    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand-mark {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-mark svg { flex: none; }
    .wordmark {
      font-size: 2rem;
      font-weight: 750;
      letter-spacing: 0.02em;
      line-height: 1;
    }
    .pill {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(21, 27, 44, 0.85);
      font-size: 0.75rem;
      color: var(--muted);
      white-space: nowrap;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 6px rgba(70, 209, 154, 0.55);
    }

    .story { display: flex; flex-direction: column; gap: 40px; max-width: 520px; }
    .story-head { display: flex; flex-direction: column; gap: 14px; }
    .kicker {
      font-size: 0.94rem;
      font-weight: 600;
      color: #8fb1ff;
    }
    .headline {
      font-size: 2.5rem;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .lead {
      font-size: 1rem;
      color: var(--muted);
      line-height: 1.65;
    }

    .features {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px 32px;
    }
    .features b {
      display: block;
      font-size: 0.94rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 6px;
    }
    .features span {
      display: block;
      font-size: 0.875rem;
      color: var(--muted);
      line-height: 1.55;
    }

    .loaded {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      color: var(--faint);
    }

    /* ---- right: the light form side ---- */
    .pane--light {
      background: var(--lt-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px;
    }

    .card {
      position: relative;
      z-index: 1;
      width: 420px;
      max-width: 100%;
      background: var(--lt-card);
      border: 1px solid var(--lt-line);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 18px 44px rgba(23, 32, 55, 0.08);
      color: var(--lt-text);
      display: flex;
      flex-direction: column;
      gap: 24px;
      animation: rise 0.55s cubic-bezier(0.22, 0.8, 0.36, 1) both;
      animation-delay: 130ms;
    }
    .card-head { display: flex; flex-direction: column; gap: 6px; }
    .card h1 {
      font-size: 1.625rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--lt-text);
    }
    .subtitle {
      font-size: 0.94rem;
      color: var(--lt-muted);
      line-height: 1.5;
    }

    .error {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--danger-bg);
      border: 1px solid var(--danger-line);
      color: var(--danger-text);
      font-size: 0.875rem;
      line-height: 1.5;
    }
    .error::before {
      content: '!';
      flex: none;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      border-radius: 50%;
      border: 2px solid currentColor;
      font-size: 0.7rem;
      font-weight: 800;
      line-height: 14px;
      text-align: center;
    }
    .error:empty { display: none; }

    form { display: flex; flex-direction: column; gap: 16px; }
    .field { display: flex; flex-direction: column; gap: 8px; }
    .field label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--lt-text);
    }
    .hint {
      font-size: 0.8125rem;
      line-height: 1.4;
      color: var(--lt-faint);
    }
    .hint--ok { color: var(--match); }
    .hint--bad { color: var(--danger-text); }
    .control { position: relative; display: flex; }
    .card input[type="text"], .card input[type="password"] {
      width: 100%;
      height: 48px;
      padding: 0 14px;
      background: var(--lt-inset);
      border: 1px solid var(--lt-field);
      border-radius: 10px;
      color: var(--lt-text);
      /* 16px stops iOS Safari from zooming into the field on focus */
      font-size: 16px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .control input { padding-right: 76px !important; }
    .card input::placeholder { color: #8a93a8; }
    .card input:focus {
      background: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--ring);
    }
    .card input[aria-invalid="true"] {
      background: #fff;
      border-color: var(--danger);
      box-shadow: 0 0 0 3px rgba(214, 69, 69, 0.15);
    }
    .reveal {
      position: absolute;
      top: 4px;
      right: 4px;
      height: 40px;
      min-width: 64px;
      padding: 0 12px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--accent-strong);
      font-size: 0.875rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
    }
    .reveal:hover { background: var(--accent-soft); }
    .card button[type="submit"] {
      width: 100%;
      height: 48px;
      margin-top: 4px;
      background: var(--accent-strong);
      border: none;
      border-radius: 10px;
      color: #fff;
      font-size: 1rem;
      font-weight: 650;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s;
    }
    .card button[type="submit"]:hover { background: var(--accent-strong-hover); }
    .card button[type="submit"]:disabled {
      background: #9fb3df;
      cursor: progress;
    }
    .card button:focus-visible, .about summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .help {
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--lt-muted);
      text-align: center;
    }

    .about {
      display: none;
      border-top: 1px solid #e6eaf2;
    }
    .about summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 48px;
      font-size: 0.94rem;
      font-weight: 600;
      color: var(--lt-text);
      cursor: pointer;
      list-style: none;
    }
    .about summary::-webkit-details-marker { display: none; }
    .about summary svg { transition: transform 0.15s; }
    .about[open] summary svg { transform: rotate(180deg); }
    .about ul {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding-bottom: 8px;
    }
    .about li {
      display: flex;
      gap: 12px;
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--lt-muted);
    }
    .about li::before {
      content: '';
      flex: none;
      width: 8px;
      height: 8px;
      margin-top: 6px;
      border-radius: 2px;
      background: var(--accent);
    }
    .about b { color: var(--lt-text); }

    .secure {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding-top: 18px;
      border-top: 1px solid #e6eaf2;
      font-size: 0.8125rem;
      color: var(--lt-faint);
      text-align: center;
    }
    .secure svg { flex: none; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
      .tile { opacity: 0.9; }
    }

    /* ---- phones and narrow windows: compact brand header, form sheet ---- */
    @media (max-width: 880px) {
      .split { flex-direction: column; }
      .pane--dark {
        flex: none;
        overflow: visible;
        background-image:
          linear-gradient(var(--line-soft) 1px, transparent 1px),
          linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
        background-size: 36px 36px;
        background-position: -1px -1px;
      }
      .board-bg, #board { display: none; }
      .pane-content {
        min-height: 0;
        max-width: none;
        gap: 0;
        padding: max(40px, env(safe-area-inset-top)) 24px 52px;
      }
      .wordmark { font-size: 1.875rem; }
      .pill { display: inline-flex; }
      .story { gap: 0; }
      .story-head { margin-top: 16px; gap: 0; }
      .kicker, .headline, .features, .loaded { display: none; }
      .lead { font-size: 0.94rem; line-height: 1.5; max-width: 22em; }
      .lead-long { display: none; }

      .pane--light {
        flex: 1 1 auto;
        display: block;
        margin-top: -24px;
        padding: 0;
        background: var(--lt-card);
        border-radius: 24px 24px 0 0;
      }
      .card {
        width: 100%;
        border: none;
        border-radius: 24px 24px 0 0;
        box-shadow: none;
        padding: 28px 24px max(24px, env(safe-area-inset-bottom));
        gap: 20px;
        animation-delay: 0ms;
      }
      .card input[type="text"], .card input[type="password"] {
        height: 52px;
        padding: 0 16px;
        border-radius: 12px;
      }
      .reveal { height: 44px; }
      .card button[type="submit"] { height: 52px; border-radius: 12px; }
      .about { display: block; }
      .secure { border-top: none; padding-top: 4px; }
    }
    @media (min-width: 881px) {
      .lead-short { display: none; }
    }
`

const PLUG_SVG = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
        stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M9 7V3" /><path d="M15 7V3" />
        <path d="M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V7z" />
        <path d="M12 16v5" />
      </svg>`

const LOCK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>`

const CHEVRON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>`

/** The four features, shared by the desktop grid and the phone disclosure. */
const FEATURES: Array<[string, string]> = [
  ['Sign-in wall', 'Pages, the API and live updates all need a session.'],
  ['Separate sessions', 'Users see only their own chats and workspace.'],
  ['User management', 'Admins manage accounts in Settings → Users.'],
  ['Remote friendly', 'Works over frp, tunnels or the LAN.'],
]

interface PageOptions {
  title: string
  heading: string
  subtitle: string
  /** Short line under the brand on phones. */
  tagline: string
  /** Text of the small status pill on phones. */
  pill: string
  fields: string
  /** Optional line under the form. */
  help?: string
  script: string
}

/** Shared page shell: dark DSH story pane + light form pane. */
function renderPage(opts: PageOptions): string {
  const grid = FEATURES.map(
    ([title, body]) => `<li><b>${title}</b><span>${body}</span></li>`,
  ).join('\n          ')
  const list = FEATURES.map(
    ([title, body]) => `<li><span><b>${title}.</b> ${body}</span></li>`,
  ).join('\n            ')
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0f1420">
  <title>${opts.title}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <main class="split">
    <section class="pane pane--dark" id="paneDark">
      <div class="board-bg" aria-hidden="true"></div>
      <div id="board" aria-hidden="true"></div>
      <div class="pane-content">
        <div class="brand-row">
          <div class="brand-mark">${PLUG_SVG}<div class="wordmark">DSH</div></div>
          <span class="pill"><i class="dot"></i>${opts.pill}</span>
        </div>
        <div class="story">
          <div class="story-head">
            <p class="kicker">A sign-in gateway, and the gate itself is a plugin.</p>
            <p class="headline">One DSH, many users, each with their own space.</p>
            <p class="lead"><span class="lead-long">dsh-login puts a sign-in wall in front of the DSH web UI so it can be shared safely on a network.</span><span class="lead-short">${opts.tagline}</span></p>
          </div>
          <ul class="features">
          ${grid}
          </ul>
        </div>
        <div class="loaded"><i class="dot"></i>dsh-login loaded</div>
      </div>
    </section>
    <section class="pane pane--light">
      <div class="card">
        <div class="card-head">
          <h1>${opts.heading}</h1>
          <p class="subtitle">${opts.subtitle}</p>
        </div>
        <div class="error" id="error" role="alert"></div>
        <form id="authForm" novalidate>${opts.fields}</form>${
          opts.help ? `\n        <p class="help">${opts.help}</p>` : ''
        }
        <details class="about">
          <summary>What is dsh-login?${CHEVRON_SVG}</summary>
          <ul>
            ${list}
          </ul>
        </details>
        <p class="secure">${LOCK_SVG}<span>Hashed passwords · HttpOnly session cookie</span></p>
      </div>
    </section>
  </main>
  <script>${FORM_JS}</script>
  <script>${opts.script}</script>
  <script>${BOARD_JS}</script>
</body>
</html>`
}

/** Login page: username + password, POSTs {username, password}. */
export function renderLoginPage(): string {
  return renderPage({
    title: 'Sign in · DSH',
    heading: 'Sign in',
    subtitle: 'Each user has their own account and sessions.',
    tagline: 'Multi-user sign-in for the DSH web UI.',
    pill: 'dsh-login',
    help: 'Forgot your password? Ask an admin to reset it.',
    fields: `
          <div class="field">
            <label for="username">Username</label>
            <input type="text" name="username" id="username" placeholder="e.g. alice"
              autocomplete="username" autocapitalize="none" autocorrect="off"
              spellcheck="false" required>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div class="control">
              <input type="password" name="password" id="password" placeholder="Your password"
                autocomplete="current-password" required>
              <button type="button" class="reveal" data-reveal="password"
                aria-pressed="false" aria-label="Show password">Show</button>
            </div>
          </div>
          <button type="submit" id="submit">Sign in</button>`,
    script: `
    var form = document.getElementById('authForm');
    var username = document.getElementById('username');
    var password = document.getElementById('password');
    var error = document.getElementById('error');
    var submit = document.getElementById('submit');

    function clearInvalid() {
      username.removeAttribute('aria-invalid');
      password.removeAttribute('aria-invalid');
    }
    username.addEventListener('input', clearInvalid);
    password.addEventListener('input', clearInvalid);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      error.textContent = '';
      clearInvalid();
      if (!username.value) {
        error.textContent = 'Enter your username';
        username.setAttribute('aria-invalid', 'true');
        username.focus();
        return;
      }
      if (!password.value) {
        error.textContent = 'Enter your password';
        password.setAttribute('aria-invalid', 'true');
        password.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      try {
        var res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.value, password: password.value }),
        });
        if (res.ok) {
          window.location = '/';
          return;
        } else if (res.status === 401) {
          error.textContent = 'Wrong username or password. Check both and try again.';
          password.value = '';
          password.setAttribute('aria-invalid', 'true');
          password.focus();
        } else if (res.status === 400) {
          error.textContent = 'Invalid request';
        } else if (res.status === 500) {
          error.textContent = 'No users exist yet. Reload the page to finish setup';
        } else {
          error.textContent = 'Something went wrong';
        }
      } catch (err) {
        error.textContent = 'Network error, please try again';
      }
      submit.disabled = false;
      submit.textContent = 'Sign in';
    });`,
  })
}

/** First-time setup page: creates the admin account via {username, password}. */
export function renderSetupPage(): string {
  return renderPage({
    title: 'Set up · DSH',
    heading: 'Create admin account',
    subtitle: 'This first account manages everyone else in Settings → Users.',
    tagline: 'No accounts exist yet. Create the first one.',
    pill: 'First run',
    fields: `
          <div class="field">
            <label for="username">Username</label>
            <input type="text" name="username" id="username" placeholder="e.g. admin"
              autocomplete="username" autocapitalize="none" autocorrect="off"
              spellcheck="false" aria-describedby="usernameHint" required>
            <span class="hint" id="usernameHint">Letters, digits, _ and -, up to 32 characters.</span>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div class="control">
              <input type="password" name="password" id="password" placeholder="Choose a password"
                autocomplete="new-password" required>
              <button type="button" class="reveal" data-reveal="password confirm"
                aria-pressed="false" aria-label="Show password">Show</button>
            </div>
          </div>
          <div class="field">
            <label for="confirm">Confirm password</label>
            <input type="password" id="confirm" placeholder="Type it again"
              autocomplete="new-password" aria-describedby="matchHint" required>
            <span class="hint" id="matchHint" aria-live="polite"></span>
          </div>
          <button type="submit" id="submit">Create account and sign in</button>`,
    script: `
    var form = document.getElementById('authForm');
    var username = document.getElementById('username');
    var pw = document.getElementById('password');
    var cf = document.getElementById('confirm');
    var match = document.getElementById('matchHint');
    var error = document.getElementById('error');
    var submit = document.getElementById('submit');

    function updateMatch() {
      cf.removeAttribute('aria-invalid');
      if (!cf.value) {
        match.textContent = '';
        match.className = 'hint';
      } else if (pw.value === cf.value) {
        match.textContent = '✓ Passwords match';
        match.className = 'hint hint--ok';
      } else {
        match.textContent = 'Passwords do not match yet';
        match.className = 'hint hint--bad';
      }
    }
    pw.addEventListener('input', updateMatch);
    cf.addEventListener('input', updateMatch);
    username.addEventListener('input', function () {
      username.removeAttribute('aria-invalid');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      error.textContent = '';
      if (username.value.length < 1) {
        error.textContent = 'Enter a username';
        username.setAttribute('aria-invalid', 'true');
        username.focus();
        return;
      }
      if (pw.value.length < 1) {
        error.textContent = 'Enter a password';
        pw.focus();
        return;
      }
      if (pw.value !== cf.value) {
        error.textContent = 'The passwords do not match';
        cf.value = '';
        updateMatch();
        cf.setAttribute('aria-invalid', 'true');
        cf.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Creating…';
      try {
        var res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.value, password: pw.value }),
        });
        if (res.ok) {
          window.location = '/';
          return;
        } else if (res.status === 403) {
          error.textContent = 'Setup is already done. Please sign in';
        } else if (res.status === 400) {
          error.textContent = 'Invalid request (usernames use letters, digits, _ and -, up to 32 characters)';
          username.setAttribute('aria-invalid', 'true');
        } else {
          error.textContent = 'Something went wrong';
        }
      } catch (err) {
        error.textContent = 'Network error, please try again';
      }
      submit.disabled = false;
      submit.textContent = 'Create account and sign in';
    });`,
  })
}
