// Server-rendered SPA shell. Pure structure + classes; app.js populates the
// panel bodies at runtime. The theme bootstrap runs inline in <head> so the
// chosen light/dark theme is applied before first paint (no flash).
//
// Data attributes that app.js reads and which MUST stay stable:
//   - [data-loading] / [data-login] / [data-app]   view-level visibility
//   - [data-nav]    (on .nav-item buttons)         sidebar entries
//   - [data-panel] / .panel  / [data-body]        one per route
//   - [data-stale]                                  cache tag inside each panel
//   - [data-refresh] / [data-refresh-current]      refresh buttons
//   - [data-theme-toggle] / [data-theme-label]     theme buttons
//   - [data-drawer-*]                               mobile drawer
//   - [data-esami-filter] / [data-appelli-search]  filter forms
//   - [data-login-form] / [data-login-submit] / [data-login-label] / [data-login-error]
//   - [data-logout]
//   - [data-toasts]                                 toast region
//   - .login-page / .login-page--submitting / .login-card  login shell
//     (app.js measures the card's offset and sets --card-slide on the page)
//
// Visual language: matches the `Delphee Design System/` design system
// (tokens in tokens/, components in components/, screens in ui_kits/delphi-
// wrapper/). The same class names, the same material depth, the same Italian
// copy. The mark is the design system's delphee-mark.svg (the institutional
// `unilogo.svg` is kept in the directory as legacy and is no longer
// referenced by the UI).

// Public repo + legal/about pages. The doc pages (privacy, sul progetto)
// import this so there is a single source of truth for the repo link.
// ponytail: hardcoded constant, not config — it changes once, at publish time.
export const GITHUB_URL = "https://github.com/selfxplanatorium/delphee";

interface Tab { id: string; label: string; icon: string; parent?: string; parentLabel?: string; }

// Sidebar groupings: "primary" = top-level direct, "Esami"/"Documenti" are groups.
const NAV: Array<Tab> = [
  { id: "riepilogo",   label: "Home",         icon: "home" },
  { id: "esami",       label: "Esami",        icon: "book",        parent: "Esami",      parentLabel: "Esami" },
  { id: "verbali",     label: "Verbali",      icon: "file-text",   parent: "Esami",      parentLabel: "Esami" },
  { id: "pendenti",    label: "Pendenti",     icon: "clock",       parent: "Esami",      parentLabel: "Esami" },
  { id: "piano",       label: "Piano",        icon: "list",        parent: "Iscrizione", parentLabel: "Iscrizione" },
  { id: "appelli",     label: "Appelli",      icon: "calendar",    parent: "Iscrizione", parentLabel: "Iscrizione" },
  { id: "tasse",       label: "Tasse",        icon: "wallet" },
  { id: "anagrafica",  label: "Anagrafica",   icon: "user",        parent: "Documenti",  parentLabel: "Documenti" },
  { id: "certificati", label: "Certificati",  icon: "award",       parent: "Documenti",  parentLabel: "Documenti" },
  { id: "servizi",     label: "Servizi",      icon: "layout-grid" },
];

// Mobile uses a hamburger drawer with the same groups as the desktop sidebar.
// No bottom tab bar — the drawer is the single source of navigation truth.
const MOBILE_TABS: string[] = [];

function navIcon(name: string): string {
  const ICONS: Record<string, string> = {
    home: '<path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z"/>',
    book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3Z"/><path d="M4 17a3 3 0 0 1 3-3h11"/>',
    "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    wallet: '<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h12"/><circle cx="17" cy="13" r="1.2" fill="currentColor"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
    "layout-grid": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    github: '<path fill="currentColor" stroke="none" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.36-3.37-1.36-.45-1.17-1.11-1.48-1.11-1.48-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.93.68 1.88 0 1.36-.01 2.45-.01 2.78 0 .27.18.59.69.48A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="m9 12 2 2 4-4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  };
  const inner = ICONS[name] || ICONS.home;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function icon(name: string, size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name}</svg>`;
}

// Sun + moon, both rendered; styles.css shows exactly one based on the resolved
// theme (.theme-toggle .icon-sun / .icon-moon). The single static sun used to
// render here never reflected state.
const SUN_PATH = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON_PATH = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
function themeIcons(): string {
  return `<span class="icon-sun">${icon(SUN_PATH, 16)}</span><span class="icon-moon">${icon(MOON_PATH, 16)}</span>`;
}

function sidebarItem(t: Tab): string {
  return `<button class="nav-item" role="link" data-nav="${t.id}" aria-current="false" tabindex="0">
    <span class="nav-icon">${navIcon(t.icon)}</span>
    <span>${t.label}</span>
  </button>`;
}

function sidebarNav(opts: { wrap?: "nav" | "div" } = {}): string {
  const wrap = opts.wrap ?? "nav";
  const groups: Record<string, Tab[]> = {};
  for (const t of NAV) {
    const key = t.parentLabel || "_";
    (groups[key] ||= []).push(t);
  }
  const order = ["_", "Esami", "Iscrizione", "Documenti"];
  let html = `<${wrap} class="sidebar-nav">`;
  // Desktop sidebar only: a single moving pill that glides between active items
  // (app.js positions it). The drawer keeps the per-item active pill. First
  // child so it paints behind the rows.
  if (wrap === "nav") html += `<span class="nav-indicator" data-nav-indicator aria-hidden="true"></span>`;
  for (const key of order) {
    if (!groups[key]) continue;
    if (key !== "_") {
      html += `<div class="sidebar-group">`;
      // Per design system: no group eyebrow label (the indent of the children
      // groups them visually). Keep the title available for screen readers.
      html += `<span class="visually-hidden">${key}</span>`;
    }
    for (const t of groups[key]) {
      html += sidebarItem(t);
    }
    if (key !== "_") html += `</div>`;
  }
  html += `</${wrap}>`;
  return html;
}

// Menu footer — the last navigational section of the side menu. Unlike the
// data tabs (SPA views toggled by app.js via [data-nav]), these are real <a>
// links to standalone pages: the repo (external) and the about/privacy pages
// served at their own URLs. Privacy is intentionally last.
function menuFooter(): string {
  const ext = icon('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', 14);
  return `
    <div class="sidebar-foot-nav">
      <a class="nav-item nav-link" role="link" href="${GITHUB_URL}" target="_blank" rel="noopener">
        <span class="nav-icon">${navIcon("github")}</span>
        <span>GitHub</span>
        <span class="nav-link-ext" aria-hidden="true">${ext}</span>
      </a>
      <a class="nav-item nav-link" role="link" href="/progetto">
        <span class="nav-icon">${navIcon("info")}</span>
        <span>Sul progetto</span>
      </a>
      <a class="nav-item nav-link" role="link" href="/privacy">
        <span class="nav-icon">${navIcon("shield")}</span>
        <span>Privacy</span>
      </a>
    </div>`;
}

// Session block — bottom of the sidebar (and drawer). Marked up as a
// placeholder; app.js fills in the student's name and matricola after login.
function sessionBlock(): string {
  return `
    <div class="session-block" data-session>
      <div class="session-id">
        <div class="session-name" data-session-name>—</div>
        <div class="session-matricola" data-session-matricola>—</div>
      </div>
      <div class="session-actions">
        <button class="btn btn-ghost btn-icon btn-sm theme-toggle" data-theme-toggle title="Cambia tema" aria-label="Cambia tema">
          ${themeIcons()}
        </button>
        <button class="btn btn-ghost btn-icon btn-sm" data-logout title="Esci" aria-label="Esci">
          ${icon('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>', 14)}
        </button>
      </div>
    </div>`;
}

function mobileTopBar(): string {
  return `
    <header class="mobile-top">
      <button class="btn btn-ghost btn-icon btn-sm hamburger" data-drawer-toggle aria-label="Apri menu" aria-expanded="false" aria-controls="mobile-drawer">
        ${icon('<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>', 18)}
      </button>
      <span class="mobile-top-logo" aria-hidden="true"></span>
      <span class="mobile-top-title">Delphee</span>
      <div class="mobile-top-actions">
        <button class="btn btn-ghost btn-icon btn-sm btn-refresh" data-refresh-current title="Aggiorna" aria-label="Aggiorna">
          ${icon('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>', 16)}
        </button>
        <button class="btn btn-ghost btn-icon btn-sm theme-toggle" data-theme-toggle title="Cambia tema" aria-label="Cambia tema">
          ${themeIcons()}
        </button>
      </div>
    </header>`;
}

function mobileDrawer(): string {
  return `
    <div class="drawer-backdrop" data-drawer-backdrop hidden></div>
    <aside class="drawer" id="mobile-drawer" role="dialog" aria-label="Menu" aria-modal="true" data-drawer hidden>
      <div class="drawer-head">
        <span class="sidebar-logo" aria-hidden="true"></span>
        <div>
          <div class="sidebar-title">Delphee</div>
          <div class="sidebar-tag">Tor Vergata</div>
        </div>
        <button class="btn btn-ghost btn-icon btn-sm drawer-close" data-drawer-close aria-label="Chiudi menu">
          ${icon('<line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>', 18)}
        </button>
      </div>
      <nav class="drawer-nav" aria-label="Sezioni">${sidebarNav({ wrap: "div" })}${menuFooter()}</nav>
      ${sessionBlock()}
    </aside>`;
}

function panels(): string {
  return NAV.map((t) => `
    <section class="panel" role="tabpanel" id="panel-${t.id}" data-panel="${t.id}" hidden aria-labelledby="nav-${t.id}">
      <header class="page-head">
        <div>
          <h1 class="page-title" id="nav-${t.id}">${t.label}</h1>
          <p class="page-sub" data-page-sub hidden></p>
        </div>
        <div class="page-actions">
          <span class="tag tag-warn" data-stale hidden>Cache non aggiornata</span>
          <button class="btn btn-secondary btn-sm btn-refresh" data-refresh="${t.id}" title="Aggiorna" aria-label="Aggiorna">
            ${icon('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>', 14)}
            <span>Aggiorna</span>
          </button>
        </div>
      </header>
      ${esamiFilter(t.id)}${appelliSearch(t.id)}
      <div class="panel-body" data-body="${t.id}"></div>
    </section>`).join("");
}

function esamiFilter(id: string): string {
  if (id !== "esami") return "";
  return `
    <form class="filterbar" data-esami-filter>
      <label class="field field-search">
        <span class="field-label">Cerca</span>
        <span class="input-wrap">
          <span class="input-icon" aria-hidden="true">${icon('<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', 16)}</span>
          <input class="input" type="search" name="nome" placeholder="Nome o SSD…" aria-label="Filtra per nome o SSD" />
        </span>
      </label>
      <label class="field field-select">
        <span class="field-label">Anno</span>
        <span class="select-wrap">
          <select class="input" name="aa" aria-label="Filtra per anno accademico">
            <option value="">Tutti</option>
          </select>
          <svg class="select-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </label>
      <label class="field field-select">
        <span class="field-label">Esito</span>
        <span class="select-wrap">
          <select class="input" name="stato" aria-label="Filtra per stato">
            <option value="">Tutti</option>
            <option value="superato">Superati</option>
            <option value="idoneo">Idonei</option>
            <option value="in_corso">In corso</option>
            <option value="non_superato">Non superati</option>
          </select>
          <svg class="select-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </label>
      <button class="btn btn-primary btn-sm" type="submit">Filtra</button>
    </form>`;
}

function appelliSearch(id: string): string {
  if (id !== "appelli") return "";
  // Server-rendered AA options: current + 3 previous (the Delphi select goes
  // back to 2002/2003, but old sessions are noise for a student app).
  const caret = `<svg class="select-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const y = new Date().getFullYear();
  const cur = new Date().getMonth() >= 8 ? y : y - 1;
  const anni = Array.from({ length: 4 }, (_, i) => `${cur - i}/${cur - i + 1}`)
    .map((aa) => `<option value="${aa}">${aa}</option>`)
    .join("");
  return `
    <form class="filterbar" data-appelli-search>
      <label class="field field-select">
        <span class="field-label">Anno</span>
        <span class="select-wrap">
          <select class="input" name="anno" aria-label="Anno accademico">${anni}</select>
          ${caret}
        </span>
      </label>
      <label class="field field-select">
        <span class="field-label">Sessione</span>
        <span class="select-wrap">
          <select class="input" name="sessione" aria-label="Sessione d'esame">
            <option value="TUTTE">Tutte</option>
            <option value="ESTIVA">Estiva</option>
            <option value="ESTIVA ANTICIPATA">Estiva anticipata</option>
            <option value="AUTUNNALE">Autunnale</option>
            <option value="INVERNALE">Invernale</option>
            <option value="STRAORDINARIA">Straordinaria</option>
          </select>
          ${caret}
        </span>
      </label>
      <button class="btn btn-primary btn-sm" type="submit">Cerca</button>
    </form>`;
}

export function renderShell(_version: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Delphee</title>
  <meta name="description" content="Il tuo portale studenti Tor Vergata." />
  <link rel="icon" type="image/svg+xml" href="/static/delphee-mark.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="/static/styles.css" />
  <script nonce="${nonce}">
    (function () {
      try {
        var t = localStorage.getItem("dw-theme");
        if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
      } catch (e) {}
    })();
  </script>
</head>
<body>
  <a class="skip-link" href="#main-content">Vai al contenuto</a>

  <!-- Loading -->
  <div class="login-page" data-loading hidden>
    <div class="login-atmosphere" aria-hidden="true">
      <span class="login-orb login-orb--one"></span>
      <span class="login-orb login-orb--two"></span>
      <span class="login-orb login-orb--three"></span>
      <span class="login-orb login-orb--four"></span>
    </div>
    <div class="login-wrap">
      <div class="login-mark">
        <span class="login-mark-img" aria-hidden="true"></span>
        <p class="muted">Caricamento…</p>
      </div>
    </div>
  </div>

  <!-- Login: the design system's centered form. No glass card, no wave, no
       split hero. The whole page IS the login. -->
  <div class="login-page" data-login hidden>
    <div class="login-atmosphere" aria-hidden="true">
      <span class="login-orb login-orb--one"></span>
      <span class="login-orb login-orb--two"></span>
      <span class="login-orb login-orb--three"></span>
      <span class="login-orb login-orb--four"></span>
    </div>
    <div class="login-wrap">
      <div class="login-mark">
        <span class="login-mark-img" aria-hidden="true"></span>
        <div class="login-name">Delphee</div>
        <div class="login-sub">Il tuo portale</div>
      </div>
      <form class="login-form" data-login-form novalidate>
        <label class="field">
          <span class="field-label">Matricola</span>
          <input class="input mono-input" name="matricola" autocomplete="username" inputmode="numeric" placeholder="es. 0312844" required />
        </label>
        <label class="field">
          <span class="field-label">Password</span>
          <input class="input" name="password" type="password" autocomplete="current-password" placeholder="••••••••" required />
        </label>
        <p class="field-error" data-login-error hidden></p>
        <button class="btn btn-primary btn-lg btn-block" type="submit" data-login-submit>
          <span class="btn-label" data-login-label aria-live="polite">Accedi</span>
        </button>
      </form>
      <p class="login-foot">
        Solo per studenti dell'Università di Roma "Tor Vergata".<br>
        Le credenziali non vengono salvate.
      </p>
      <nav class="login-links" aria-label="Link">
        <a href="${GITHUB_URL}" target="_blank" rel="noopener">
          ${icon('<path fill="currentColor" stroke="none" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.48 0-.24-.01-.87-.01-1.7-2.78.62-3.37-1.36-3.37-1.36-.45-1.17-1.11-1.48-1.11-1.48-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.93.68 1.88 0 1.36-.01 2.45-.01 2.78 0 .27.18.59.69.48A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"/>', 15)}
          <span>GitHub</span>
        </a>
        <a href="/progetto">Sul progetto</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </div>
  </div>

  <!-- App -->
  <div class="app" data-app hidden>
    ${mobileTopBar()}
    <aside class="sidebar" aria-label="Navigazione principale">
      <div class="sidebar-head">
        <span class="sidebar-logo" aria-hidden="true"></span>
        <div>
          <div class="sidebar-title">Delphee</div>
          <div class="sidebar-tag">Tor Vergata</div>
        </div>
      </div>
      ${sidebarNav()}
      ${menuFooter()}
      ${sessionBlock()}
    </aside>

    <main id="main-content" class="main">
      <div class="main-inner">
        ${panels()}
      </div>
    </main>

    ${mobileDrawer()}
  </div>

  <div class="toast-region" data-toasts aria-live="polite"></div>

  <script src="/static/app.js" type="module"></script>
</body>
</html>`;
}
