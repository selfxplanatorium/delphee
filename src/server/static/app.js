// Delphi Wrapper SPA controller — vanilla JS, no framework, no build step.
//
// Responsibilities: theme toggle, session gate (login vs app), sidebar nav,
// one lazy loader + renderer per view. Renderers build DOM via el() so there's
// no innerHTML injection of server data. Errors map to Italian via describeError;
// X-Cache-Stale surfaces as a per-page tag.

const NAV = ["riepilogo", "statistiche", "sessione", "esami", "verbali", "pendenti", "prenotazioni", "piano", "appelli", "corsi", "tasse", "certificati", "servizi", "anagrafica"];

const state = {
  matricola: "",
  version: "",
  token: "",
  activeView: "riepilogo",
  loaded: new Set(),
  loadGeneration: new Map(),
  carriera: null,
  carrieraStale: false,
  esamiFilter: { nome: "", ssd: "", aa: "", stato: "" },
  appelliFilter: { anno: "", sessione: "TUTTE" },
  // Grade simulator rows ({ nome, cfu, voto }); in memory only.
  sim: null,
  sessioneEscludi: new Map(),
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------------------- helpers ---------------------------- */
function setStyles(node, styles) {
  for (const [p, val] of Object.entries(styles)) {
    if (p.startsWith("--")) node.style.setProperty(p, val);
    else node.style[p] = val;
  }
}
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    // Through the CSSOM: the page's CSP blocks style attributes, and custom
    // properties (--x) only take effect via setProperty.
    else if (k === "style" && typeof v === "object") setStyles(node, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

const ICO = {
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  wallet: '<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h12"/><circle cx="17" cy="13" r="1.2" fill="currentColor"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13 17 22l-5-3-5 3 1.5-9"/>',
  book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3Z"/><path d="M4 17a3 3 0 0 1 3-3h11"/>',
  "layout-grid": '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
};
function ico(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[name] || ""}</svg>`;
}
function icoNode(name, size = 18) {
  const span = document.createElement("span");
  span.innerHTML = ico(name, size);
  return span.firstChild;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function fmtEuro(v) {
  if (v == null) return "—";
  return "€ " + Number(v).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function txt(v) { return v == null || v === "" ? "—" : String(v); }
// For the one place a string reaches innerHTML (setPageHead's title, which may
// carry an <em>): everything interpolated into it goes through here first.
function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
// Local calendar date as YYYY-MM-DD (toISOString alone is UTC and flips a
// day early around midnight in Italy).
function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
function daysUntil(iso) {
  const days = Math.round((Date.parse(iso) - Date.parse(todayIso())) / 86_400_000);
  return days === 0 ? "oggi" : days === 1 ? "domani" : days > 1 ? `tra ${days} giorni` : `${-days} giorni fa`;
}

function tag(text, kind = "muted") {
  return el("span", { class: `tag tag-${kind}` }, text);
}

// Count-up animation: from 0 to value over `ms`, fires on mount.
// 600ms matches the design system's --dur-count token.
function countUp(node, to, ms = 600, decimals = 0) {
  if (to == null || isNaN(to)) { node.textContent = "—"; return; }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || ms <= 0) { node.textContent = Number(to).toFixed(decimals); return; }
  const start = performance.now();
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
  const from = 0;
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    const v = from + (to - from) * easeOutQuint(t);
    node.textContent = v.toFixed(decimals);
    if (t < 1) requestAnimationFrame(step);
    else node.textContent = Number(to).toFixed(decimals);
  };
  requestAnimationFrame(step);
}

async function api(path, init = {}) {
  const headers = { Accept: "application/json", ...(init.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...init, headers });
  const stale = res.headers.get("X-Cache-Stale") === "true";
  let body;
  try { body = await res.json(); } catch { body = { error: "invalid_response" }; }
  // Dev reloads and idle eviction remove the server-side session. An open tab
  // may still hold its old token; take it back to login once instead of making
  // every protected view render an unrelated generic error.
  if (res.status === 401 && body.error === "no_session") {
    state.token = "";
    state.loaded.clear();
    state.loadGeneration.clear();
    state.carriera = null;
    show("login");
  }
  return { ok: res.ok, status: res.status, body, stale };
}

const ERRORS = {
  invalid_credentials: "Credenziali non valide. Riprova.",
  no_session: "La sessione è scaduta. Accedi di nuovo.",
  missing_credentials: "Inserisci matricola e password.",
  rate_limited: "Troppi tentativi. Riprova tra poco.",
  delphi_unavailable: "Delphi non è raggiungibile al momento.",
  missing_insegnamento: "Inserisci un codice insegnamento.",
  missing_bollettinoId: "Bollettino non valido.",
  invalid_prenotazione: "Prenotazione non valida.",
  invalid_piano: "Piano non valido.",
  invalid_insegnamento: "Insegnamento non valido.",
  invalid_response: "Risposta non valida dal server.",
};
function describeError(body) { return ERRORS[body && body.error] || "Errore imprevisto."; }
function refreshed(path, force) {
  if (!force) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}refresh=1`;
}

function toast(message, kind = "info") {
  const region = $("[data-toasts]");
  const node = el("div", { class: `toast ${kind}` }, [
    icoNode(["ok", "bad", "info"].includes(kind) ? (kind === "ok" ? "user" : kind === "bad" ? "inbox" : "inbox") : "inbox", 16),
    el("span", {}, message),
    el("button", { class: "toast-close", "aria-label": "Chiudi",
      onClick: () => { node.style.opacity = "0"; setTimeout(() => node.remove(), 180); }
    }, icoNode("external", 14)),
  ]);
  // Use a sensible icon by kind
  region.append(node);
  setTimeout(() => { if (node.isConnected) { node.style.opacity = "0"; setTimeout(() => node.remove(), 180); } }, 4000);
}

/* Per-panel page-head helpers. The page title and subtitle are server-rendered
 * in the shell with a default; the RENDERER updates them with view-specific
 * copy (the home page replaces "Home" with a personal "Bentornato, Mario",
 * for example). title accepts an HTML string so the renderer can pass a
 * greeting with an <em> for the name. */
function setPageHead(id, { title, subtitle } = {}) {
  const panel = $(`#panel-${id}`);
  if (!panel) return;
  const titleEl = panel.querySelector(".page-title");
  const subEl = panel.querySelector(".page-sub");
  if (title != null && titleEl) titleEl.innerHTML = title;
  if (subtitle) {
    if (subEl) { subEl.textContent = subtitle; subEl.hidden = false; }
  } else if (subEl) {
    subEl.hidden = true;
  }
}

/* Populate the session block (sidebar + drawer) with the student's name and
 * matricola. Called from the riepilogo renderer, which is the canonical place
 * where both pieces of data are known. */
function fillSession(name, matricola) {
  $$("[data-session-name]").forEach((n) => { n.textContent = name; });
  $$("[data-session-matricola]").forEach((m) => { m.textContent = matricola; });
}

/* ---------------------------- theme ---------------------------- */
function resolvedTheme() {
  const set = document.documentElement.getAttribute("data-theme");
  if (set) return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function toggleTheme() {
  const next = resolvedTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("dw-theme", next); } catch {}
}

/* ---------------------------- view switching ---------------------------- */
function show(which) {
  $("[data-loading]").hidden = which !== "loading";
  $("[data-login]").hidden = which !== "login";
  $("[data-app]").hidden = which !== "app";
  if (which === "app") {
    document.body.scrollTop = 0;
  }
  if (which === "login") {
    /* Coming back to the login form — any state from a prior submit attempt
     * (in-flight class, disabled button, the cycling staged label + its timer,
     * filled inputs, visible error) must be cleared, otherwise the next time
     * the user visits the form (e.g. after logout) it shows a mid-cycle label
     * and the card still offset toward center. */
    resetLoginState();
    /* Defer one frame so the layout is final before we measure. */
    requestAnimationFrame(layoutLoginCard);
  }
}

/* Restore the login form to its default state. Idempotent. */
function resetLoginState() {
  const page = $("[data-login]");
  page?.classList.remove("login-page--submitting");
  const submit = $("[data-login-submit]");
  if (submit) submit.disabled = false;
  stopLoginProgress();
  const errEl = $("[data-login-error]");
  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  const form = $("[data-login-form]");
  if (form) form.reset();
}

/* Measure the card's natural position (anchored to the right by the wrap's
 * flex-end) and the page center. The card's center is right-of-page-center
 * by some distance X. We store -X as --card-slide on the page; on submit
 * the card's transform animates from 0 to translateX(-X), sliding it left
 * to dead center. Called on every login show + on resize while the login
 * is visible. Skipped mid-submit: the card is already centered and a
 * re-measure would clobber the offset needed for the post-error reverse. */
function layoutLoginCard() {
  const page = $("[data-login]");
  if (!page || page.hidden) return;
  if (page.classList.contains("login-page--submitting")) return;
  const card = page.querySelector(".login-card");
  if (!card) return;
  const pageRect = page.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const cardCenter = cardRect.left + cardRect.width / 2;
  const pageCenter = pageRect.left + pageRect.width / 2;
  // Positive X = card is right of page center. We negate so a translateX
  // animation in the submitting state moves the card LEFT to center.
  const slideToCenter = -(cardCenter - pageCenter);
  page.style.setProperty("--card-slide", `${slideToCenter}px`);
}

function activateView(id, opts = {}) {
  state.activeView = id;
  $$("[data-nav]").forEach((b) => {
    const on = b.dataset.nav === id;
    b.setAttribute("aria-current", on ? "page" : "false");
  });
  positionNavIndicator();
  $$(".panel").forEach((p) => { p.hidden = p.dataset.panel !== id; });
  $$(".panel").forEach((p) => { if (!p.hidden) p.classList.remove("fade-in"); void p.offsetWidth; p.classList.add("fade-in"); });
  if (!state.loaded.has(id) || opts.force) loadView(id, opts.force);
  if (opts.scrollTop !== false) window.scrollTo({ top: 0, behavior: "instant" in opts ? "instant" : "smooth" });
}

/* Glide the desktop sidebar's active pill to the current row. Measures live
 * rects (rows sit in groups with gaps, so offsetTop alone won't do). The first
 * placement skips the transition so the pill appears in place, then fades in;
 * subsequent calls animate the slide. Skipped when the sidebar is hidden
 * (mobile uses the drawer's per-row pill). */
function positionNavIndicator() {
  const nav = $(".sidebar .sidebar-nav");
  const ind = $("[data-nav-indicator]");
  if (!nav || !ind) return;
  const active = nav.querySelector('.nav-item[aria-current="page"]');
  if (!active || !active.offsetParent) return; // hidden (mobile breakpoint)
  const y = active.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop;
  const first = !ind.classList.contains("is-placed");
  if (first) ind.style.transition = "none";
  ind.style.height = `${active.offsetHeight}px`;
  ind.style.transform = `translateY(${y}px)`;
  if (first) {
    void ind.offsetWidth; // commit the no-transition placement before re-enabling
    ind.style.transition = "";
    ind.classList.add("is-placed");
  }
}

/* ---------------------------- loaders ---------------------------- */
async function loadCarriera(force) {
  if (state.carriera && !force) return { data: state.carriera, stale: state.carrieraStale };
  const { ok, body, stale } = await api(refreshed("/carriera", force));
  if (!ok) throw body;
  state.carriera = body; state.carrieraStale = stale;
  return { data: body, stale };
}

const LOADERS = {
  riepilogo: (force) => loadCarriera(force),
  esami: async (force) => {
    const q = new URLSearchParams();
    const f = state.esamiFilter;
    if (f.nome) q.set("nome", f.nome);
    if (f.ssd) q.set("ssd", f.ssd);
    if (f.aa) q.set("aa", f.aa);
    if (f.stato) q.set("stato", f.stato);
    const { ok, body, stale } = await api(refreshed(`/carriera/esami?${q}`, force));
    if (!ok) throw body;
    return { data: body, stale };
  },
  appelli: async (force) => {
    const q = new URLSearchParams();
    if (state.appelliFilter.anno) q.set("anno", state.appelliFilter.anno);
    if (state.appelliFilter.sessione) q.set("sessione", state.appelliFilter.sessione);
    const { ok, body, stale } = await api(refreshed(`/appelli?${q}`, force));
    if (!ok) throw body;
    return { data: body, stale };
  },
  piano: async (force) => { const r = await api(refreshed("/piano", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  // ISEE is best-effort: a failure there must not hide the fees themselves.
  tasse: async (force) => {
    const [r, isee] = await Promise.all([api(refreshed("/tasse", force)), api(refreshed("/tasse/isee", force))]);
    if (!r.ok) throw r.body;
    return { data: { ...r.body, isee: isee.ok ? isee.body.autorizzazioni : [] }, stale: r.stale || (isee.ok && isee.stale) };
  },
  servizi: async (force) => { const r = await api(refreshed("/servizi", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  certificati: async (force) => { const r = await api(refreshed("/certificati", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  anagrafica: async (force) => { const r = await api(refreshed("/anagrafica", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  verbali: async (force) => { const r = await api(refreshed("/verbali", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  pendenti: async (force) => { const r = await api(refreshed("/esami-pendenti", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  statistiche: async (force) => { const r = await api(refreshed("/carriera/insights", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  sessione: async (force) => {
    const q = state.sessioneEscludi.size ? `?escludi=${[...state.sessioneEscludi.keys()].join(",")}` : "";
    const r = await api(refreshed(`/carriera/sessione${q}`, force));
    if (!r.ok) throw r.body;
    return { data: r.body, stale: r.stale };
  },
  corsi: async (force) => { const r = await api(refreshed("/corsi", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  prenotazioni: async (force) => { const r = await api(refreshed("/prenotazioni", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
};

function skeleton(body, rows = 5) {
  body.replaceChildren(
    el("div", { class: "skel-block" }),
    el("div", { class: "skeleton" }, Array.from({ length: rows }, () => el("div", { class: "skel-row" }))),
  );
}

// ponytail: views listed here are temporarily stubbed with a "work in
// progress" state — they skip the Delphi fetch entirely. Currently empty.
const WIP_VIEWS = new Set();

async function loadView(id, force = false) {
  const body = $(`[data-body="${id}"]`);
  const staleTag = $(`#panel-${id} [data-stale]`);
  if (!body) return;
  if (WIP_VIEWS.has(id)) {
    staleTag.hidden = true;
    $(`#panel-${id} .filterbar`)?.setAttribute("hidden", "");
    body.replaceChildren(emptyState("Work in progress", "Questa sezione è in lavorazione. Torna presto.", "zap"));
    state.loaded.add(id);
    return;
  }
  skeleton(body);
  const generation = (state.loadGeneration.get(id) || 0) + 1;
  state.loadGeneration.set(id, generation);
  try {
    const { data, stale } = await LOADERS[id](force);
    if (state.loadGeneration.get(id) !== generation) return;
    staleTag.hidden = !stale;
    RENDERERS[id](body, data);
    state.loaded.add(id);
  } catch (errBody) {
    if (state.loadGeneration.get(id) !== generation) return;
    staleTag.hidden = true;
    body.replaceChildren(emptyState("Errore", describeError(errBody)));
  }
}

/* ---------------------------- empty state ---------------------------- */
function emptyState(title, hint, iconName = "inbox") {
  return el("div", { class: "empty" }, [
    el("div", { class: "flex-row gap-2" }, [
      icoNode(iconName, 18),
      el("strong", { class: "empty-title" }, title),
    ]),
    hint ? el("p", { class: "empty-hint mt-3" }, hint) : null,
  ]);
}

/* ---------------------------- table helpers ---------------------------- */
function votoBadge(e) {
  if (!e.votoLabel) return el("span", { class: "voto fail" }, e.stato === "non_superato" ? "—" : "in corso");
  let cls = "voto";
  if (e.voto && e.voto.tipo === "trentesimi" && e.voto.lode) cls += " lode";
  else if (e.stato === "idoneo") cls += " idoneo";
  else if (e.isPartial) cls += " partial";
  return el("span", { class: cls }, e.votoLabel);
}

function dataTable(headers, rows) {
  const thead = el("tr", {}, headers.map((h) => el("th", { class: h.num ? "num" : null }, h.label)));
  const tbody = rows.map((cells, i) =>
    el("tr", { class: i < 14 ? "row-in" : null, style: i < 14 ? { animationDelay: `${i * 40}ms` } : null },
      cells.map((c, j) => {
        const node = el("td", {
          class: c && c.num ? "num" : (c && c.mono ? "mono" : null),
          "data-label": headers[j]?.label || "",
        });
        if (c && c.node) node.append(c.node);
        else node.textContent = c == null ? "" : String(c);
        return node;
      })));
  return el("div", { class: "table-wrap" }, [el("table", { class: "data" }, [el("thead", {}, thead), el("tbody", {}, tbody)])]);
}

function summaryChips(s) {
  return el("div", { class: "flex-row mt-4 mb-4", style: { flexWrap: "wrap" } }, [
    tag(`${s.superati ?? 0} superati`, "ok"),
    s.idonei != null ? tag(`${s.idonei} idonei`, "info") : null,
    s.inCorso != null ? tag(`${s.inCorso} in corso`, "muted") : null,
    s.cfuSuperati != null ? tag(`${s.cfuSuperati} CFU`, "muted") : null,
    s.cfuMedia != null ? tag(`media ${s.cfuMedia}`, "muted") : null,
  ]);
}

/* ---------------------------- charts ---------------------------- */
// Small SVG charts for Statistiche, following the dataviz method: one y axis,
// hairline solid grid, 2px lines, >=8px dots with a 2px surface ring, columns
// at most 24px wide with a 4px rounded data end, text in ink tokens (never the
// series color), a hover/focus tooltip on every chart, and a table view.
// Marks use --chart-mark (validated brand green) and --ink-3 for reference
// lines; a dashed line always means "projected".
const SVGNS = "http://www.w3.org/2000/svg";
const CHART_W = 640;
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "style" && typeof v === "object") setStyles(node, v);
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}
const tsOf = (iso) => Date.parse(iso);
function fmtMonth(t) {
  return new Date(t).toLocaleDateString("it-IT", { month: "short", year: "numeric" });
}
function fmtNum(v, d = 0) {
  return v == null ? "—" : Number(v).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Chart shell: title, legend (only for 2+ series), the plot, and a table view
// so no value depends on hovering.
function chartFigure({ title, legend, plot, table }) {
  return el("figure", { class: "chart" }, [
    el("figcaption", { class: "chart-title" }, title),
    legend && legend.length > 1
      ? el("div", { class: "chart-legend" }, legend.map((l) => el("span", { class: "chart-key" }, [
          el("span", { class: `chart-swatch ${l.kind}`, style: { "--key": l.color } }),
          l.name,
        ])))
      : null,
    plot,
    table ? el("details", { class: "chart-table" }, [
      el("summary", {}, "Mostra i dati in tabella"),
      dataTable(table.headers.map((h) => ({ label: h, num: false })), table.rows),
    ]) : null,
  ]);
}

function tooltipNode() {
  return el("div", { class: "chart-tip", hidden: true, role: "status" });
}
function showTip(tip, plot, x, y, header, rows) {
  tip.replaceChildren(
    el("div", { class: "chart-tip-head" }, header),
    ...rows.map((r) => el("div", { class: "chart-tip-row" }, [
      el("span", { class: `chart-tip-key ${r.kind || "line"}`, style: { "--key": r.color } }),
      el("strong", {}, r.value),
      el("span", {}, r.name),
    ])),
  );
  tip.hidden = false;
  const box = plot.getBoundingClientRect();
  const left = Math.min(Math.max(x + 12, 0), box.width - tip.offsetWidth - 4);
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 0)}px`;
}

// Time-axis chart. series: { name, color, dash, step, line (default true),
// dots, points: [{ t, y, label? }], valueLabel(y) }. A crosshair snaps to the
// nearest data date; the tooltip lists every series at that date.
function timeChart({ series, yMin, yMax, yTicks, height = 240, yFormat = (v) => fmtNum(v), endLabels = true, ariaLabel }) {
  const m = { l: 40, r: endLabels ? 96 : 16, t: 14, b: 28 };
  const all = series.flatMap((s) => s.points);
  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  const span = Math.max(tMax - tMin, 86_400_000);
  const X = (t) => m.l + ((t - tMin) / span) * (CHART_W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - yMin) / (yMax - yMin)) * (height - m.t - m.b);
  const svg = svgEl("svg", { viewBox: `0 0 ${CHART_W} ${height}`, class: "chart-svg", role: "img", "aria-label": ariaLabel, tabindex: 0 });

  for (const v of yTicks) {
    svg.append(svgEl("line", { x1: m.l, x2: CHART_W - m.r, y1: Y(v), y2: Y(v), class: "chart-grid" }));
    svg.append(svgEl("text", { x: m.l - 6, y: Y(v) + 4, class: "chart-axis", "text-anchor": "end" }, yFormat(v)));
  }
  // X ticks: one per year (or per quarter for short spans), labelled compactly.
  const years = span > 2 * 365 * 86_400_000;
  const d = new Date(tMin);
  const cursor = years ? new Date(d.getFullYear() + 1, 0, 1) : new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 1);
  for (; cursor.getTime() <= tMax; years ? cursor.setFullYear(cursor.getFullYear() + 1) : cursor.setMonth(cursor.getMonth() + 3)) {
    const x = X(cursor.getTime());
    svg.append(svgEl("text", { x, y: height - 8, class: "chart-axis", "text-anchor": "middle" },
      years ? String(cursor.getFullYear()) : cursor.toLocaleDateString("it-IT", { month: "short", year: "2-digit" })));
  }

  for (const s of series) {
    const pts = [...s.points].sort((a, b) => a.t - b.t);
    if (s.line !== false && pts.length > 1) {
      let dPath = `M${X(pts[0].t)},${Y(pts[0].y)}`;
      for (let i = 1; i < pts.length; i++) {
        dPath += s.step ? `H${X(pts[i].t)}V${Y(pts[i].y)}` : `L${X(pts[i].t)},${Y(pts[i].y)}`;
      }
      svg.append(svgEl("path", { d: dPath, class: `chart-line${s.dash ? " is-dashed" : ""}`, style: { "--mark": s.color } }));
    }
    if (s.dots) for (const p of pts) svg.append(svgEl("circle", { cx: X(p.t), cy: Y(p.y), r: 4.5, class: "chart-dot", style: { "--mark": s.color } }));
    if (endLabels && s.endLabel && pts.length) {
      const last = pts[pts.length - 1];
      svg.append(svgEl("text", { x: X(last.t) + 8, y: Y(last.y) + 4, class: "chart-end" }, s.endLabel));
    }
  }

  // Hover layer.
  const cross = svgEl("line", { y1: m.t, y2: height - m.b, class: "chart-cross", visibility: "hidden" });
  svg.append(cross);
  const stops = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);
  const valueAt = (s, t) => {
    const pts = [...s.points].sort((a, b) => a.t - b.t);
    if (s.line === false) return pts.find((p) => p.t === t) || null;
    if (t < pts[0].t || t > pts[pts.length - 1].t) return null;
    if (s.step) return [...pts].reverse().find((p) => p.t <= t) || null;
    const i = pts.findIndex((p) => p.t >= t);
    if (pts[i].t === t || i === 0) return pts[i];
    const a = pts[i - 1], b = pts[i];
    return { t, y: a.y + ((t - a.t) / (b.t - a.t)) * (b.y - a.y) };
  };
  const plot = el("div", { class: "chart-plot" }, [svg]);
  const tip = tooltipNode();
  plot.append(tip);
  let idx = -1;
  const show = (i) => {
    idx = Math.max(0, Math.min(stops.length - 1, i));
    const t = stops[idx];
    const x = X(t);
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
    const rows = series.map((s) => ({ s, p: valueAt(s, t) })).filter((r) => r.p).map(({ s, p }) => ({
      color: s.color, kind: s.dots && s.line === false ? "dot" : s.dash ? "dash" : "line",
      value: s.valueLabel ? s.valueLabel(p) : yFormat(p.y), name: p.label ? `${s.name} · ${p.label}` : s.name,
    }));
    const scale = svg.getBoundingClientRect().width / CHART_W;
    showTip(tip, plot, x * scale, 0, fmtDate(new Date(t).toISOString().slice(0, 10)), rows);
  };
  const hide = () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; };
  svg.addEventListener("pointermove", (e) => {
    const box = svg.getBoundingClientRect();
    const t = tMin + (((e.clientX - box.left) / box.width) * CHART_W - m.l) / (CHART_W - m.l - m.r) * span;
    let best = 0;
    stops.forEach((s, i) => { if (Math.abs(s - t) < Math.abs(stops[best] - t)) best = i; });
    show(best);
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); show(idx + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); show(idx < 0 ? stops.length - 1 : idx - 1); }
    if (e.key === "Escape") hide();
  });
  return plot;
}

// Column chart for categories. Values sit on the caps of non-empty columns;
// each column's whole band is its hover/focus target.
function columnChart({ data, height = 200, ariaLabel, valueLabel = (d) => fmtNum(d.value), tipName }) {
  const m = { l: 12, r: 12, t: 22, b: 28 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const band = (CHART_W - m.l - m.r) / data.length;
  // 18 viewBox units ≈ 24px at the content width (880px over 640 units).
  const w = Math.min(18, band * 0.62);
  const Y = (v) => m.t + (1 - v / max) * (height - m.t - m.b);
  const base = height - m.b;
  const svg = svgEl("svg", { viewBox: `0 0 ${CHART_W} ${height}`, class: "chart-svg", role: "img", "aria-label": ariaLabel });
  svg.append(svgEl("line", { x1: m.l, x2: CHART_W - m.r, y1: base, y2: base, class: "chart-grid" }));
  const plot = el("div", { class: "chart-plot" }, [svg]);
  const tip = tooltipNode();
  plot.append(tip);
  data.forEach((d, i) => {
    const cx = m.l + band * i + band / 2;
    const g = svgEl("g", { class: "chart-col", tabindex: 0, role: "img", "aria-label": `${d.label}: ${valueLabel(d)}` });
    g.append(svgEl("rect", { x: cx - band / 2, y: m.t, width: band, height: base - m.t, class: "chart-hit" }));
    if (d.value > 0) {
      const top = Y(d.value);
      const r = Math.min(4, (base - top) / 2, w / 2);
      g.append(svgEl("path", {
        class: "chart-bar", style: { "--mark": "var(--chart-mark)" },
        d: `M${cx - w / 2},${base}V${top + r}Q${cx - w / 2},${top} ${cx - w / 2 + r},${top}H${cx + w / 2 - r}Q${cx + w / 2},${top} ${cx + w / 2},${top + r}V${base}Z`,
      }));
      g.append(svgEl("text", { x: cx, y: top - 6, class: "chart-cap", "text-anchor": "middle" }, valueLabel(d)));
    }
    g.append(svgEl("text", { x: cx, y: height - 8, class: "chart-axis", "text-anchor": "middle" }, d.label));
    const show = () => {
      const scale = svg.getBoundingClientRect().width / CHART_W;
      showTip(tip, plot, cx * scale, Y(Math.max(d.value, 0)) * scale, d.label, [{ color: "var(--chart-mark)", kind: "bar", value: valueLabel(d), name: tipName }]);
    };
    g.addEventListener("pointerenter", show);
    g.addEventListener("focus", show);
    g.addEventListener("pointerleave", () => { tip.hidden = true; });
    g.addEventListener("blur", () => { tip.hidden = true; });
    svg.append(g);
  });
  return plot;
}

/* ---------------------------- statistiche ---------------------------- */
const ESITO = {
  superato: { text: "superato", kind: "ok" },
  non_superato: { text: "non superato", kind: "bad" },
  senza_esito: { text: "nessun esito", kind: "warn" },
  in_programma: { text: "in programma", kind: "info" },
};
const CHECK = {
  ok: { text: "Fatto", kind: "ok" },
  da_fare: { text: "Da fare", kind: "muted" },
  attenzione: { text: "Attenzione", kind: "warn" },
  info: { text: "Info", kind: "info" },
};
const sectionLabel = (text, meta) => el("div", { class: "section-label" }, [
  el("span", { class: "label-text" }, text),
  meta ? el("span", { class: "label-meta muted" }, meta) : null,
]);
const statTile = (label, value, sub) => el("div", { class: "stat" }, [
  el("div", { class: "stat-label" }, label),
  el("div", {}, [el("span", { class: "stat-value" }, value), sub ? el("span", { class: "stat-sub" }, sub) : null]),
]);

function statsForecast(ins) {
  const p = ins.previsione;
  const g = ins.progresso;
  const today = tsOf(ins.oggi);
  const start = p.aaImmatricolazione ? tsOf(`${p.aaImmatricolazione.slice(0, 4)}-10-01`) : (p.cfuCumulati[0] ? tsOf(p.cfuCumulati[0].data) : today);
  const actual = [{ t: start, y: 0 }, ...p.cfuCumulati.map((c) => ({ t: tsOf(c.data), y: c.cfu })), { t: today, y: g.cfuAcquisiti }];
  // The actual line is labelled only when no projection starts at its end.
  const series = [{ name: "Crediti acquisiti", color: "var(--chart-mark)", step: true, points: actual, endLabel: g.cfuMancanti > 0 && p.dataStimata ? null : `${g.cfuAcquisiti} CFU` }];
  // A projection further than eight years out is cut at the edge with the
  // value it reaches there; the text above carries the full date.
  const cap = today + 8 * 365.25 * 86_400_000;
  if (p.dataStimata && g.cfuMancanti > 0) {
    const end = Math.min(tsOf(p.dataStimata), cap);
    const y = g.cfuAcquisiti + (g.cfuMancanti * (end - today)) / (tsOf(p.dataStimata) - today);
    series.push({ name: "Proiezione al tuo ritmo", color: "var(--chart-mark)", dash: true, points: [{ t: today, y: g.cfuAcquisiti }, { t: end, y }], endLabel: `laurea ${fmtMonth(tsOf(p.dataStimata))}` });
  }
  if (p.scadenzaInCorso && tsOf(p.scadenzaInCorso) > today && g.cfuMancanti > 0) {
    series.push({ name: "Per laurearti in corso", color: "var(--ink-3)", dash: true, points: [{ t: today, y: g.cfuAcquisiti }, { t: tsOf(p.scadenzaInCorso), y: g.cfuTotali }], endLabel: "in corso" });
  }
  const step = g.cfuTotali > 120 ? 60 : 30;
  const ticks = Array.from({ length: Math.floor(g.cfuTotali / step) + 1 }, (_, i) => i * step);
  if (ticks[ticks.length - 1] !== g.cfuTotali) ticks.push(g.cfuTotali);

  const summary = [];
  if (g.cfuMancanti === 0) summary.push("Hai tutti i crediti del piano.");
  else if (p.dataStimata) {
    summary.push(`Al ritmo ${p.ritmoRecente > 0 ? "degli ultimi 12 mesi" : "medio"} (${fmtNum(p.ritmoUsato, 0)} CFU l'anno) ti mancano circa ${fmtNum(g.cfuMancanti / p.ritmoUsato, 1)} anni: laurea intorno a ${fmtMonth(tsOf(p.dataStimata))} (AA ${p.aaStimato}).`);
  } else summary.push("Non ci sono ancora abbastanza esami per stimare il tuo ritmo.");
  if (p.scadenzaInCorso && p.scadenzaInCorso < ins.oggi && g.cfuMancanti > 0) {
    summary.push(`La durata normale del corso è già trascorsa (ultimo anno in corso: ${p.ultimoAaInCorso}).`);
  } else if (p.cfuAnnoNecessari != null && g.cfuMancanti > 0) {
    summary.push(`Per laurearti in corso (ultimo anno ${p.ultimoAaInCorso}, sessioni fino a circa ${fmtMonth(tsOf(p.scadenzaInCorso))}) servono ${fmtNum(p.cfuAnnoNecessari, 0)} CFU l'anno.`);
  }
  const status = p.inCorso == null ? null : p.inCorso ? tag("In linea per laurearti in corso", "ok") : tag("Al ritmo attuale andresti fuori corso", "warn");

  return el("div", { class: "section" }, [
    sectionLabel("Previsione di laurea", g.totaliDaPiano ? "dal tuo piano di studi" : `${g.cfuTotali} CFU stimati, piano non disponibile`),
    el("div", { class: "flex-row mb-3" }, [status]),
    ...summary.map((s) => el("p", { class: "stats-text" }, s)),
    chartFigure({
      title: "Crediti nel tempo",
      legend: series.map((s) => ({ name: s.name, color: s.color, kind: s.dash ? "dash" : "line" })),
      plot: timeChart({ series, yMin: 0, yMax: g.cfuTotali, yTicks: ticks, ariaLabel: "Crediti acquisiti nel tempo con proiezione", yFormat: (v) => fmtNum(v), }),
      table: { headers: ["Data", "CFU totali"], rows: p.cfuCumulati.map((c) => [fmtDate(c.data), String(c.cfu)]) },
    }),
  ]);
}

function statsGrades(ins) {
  const md = ins.media;
  const out = [];
  if (md.andamento.length) {
    const pts = md.andamento.map((a) => ({ t: tsOf(a.data), y: a.voto, label: a.nome, lode: a.lode }));
    out.push(chartFigure({
      title: "Voti e media nel tempo",
      legend: [{ name: "Voto", color: "var(--chart-mark)", kind: "dot" }, { name: "Media ponderata", color: "var(--ink-3)", kind: "line" }],
      plot: timeChart({
        ariaLabel: "Voto di ogni esame e media ponderata nel tempo",
        yMin: 18, yMax: 30, yTicks: [18, 21, 24, 27, 30], endLabels: true,
        series: [
          { name: "Voto", color: "var(--chart-mark)", line: false, dots: true, points: pts, valueLabel: (p) => (p.lode ? "30 e lode" : String(p.y)) },
          { name: "Media ponderata", color: "var(--ink-3)", step: true, points: md.andamento.map((a) => ({ t: tsOf(a.data), y: a.mediaCumulata })), endLabel: `media ${fmtNum(md.ponderata, 2)}`, valueLabel: (p) => fmtNum(p.y, 2) },
        ],
      }),
      table: { headers: ["Data", "Esame", "Voto", "CFU", "Media dopo l'esame"], rows: md.andamento.map((a) => [fmtDate(a.data), a.nome, a.lode ? "30 e lode" : String(a.voto), String(a.cfu), fmtNum(a.mediaCumulata, 2)]) },
    }));
    out.push(chartFigure({
      title: "Distribuzione dei voti",
      plot: columnChart({ ariaLabel: "Numero di esami per voto", tipName: "esami", data: md.distribuzione.map((d) => ({ label: d.voto === "30L" ? "30L" : d.voto, value: d.esami })) }),
      table: { headers: ["Voto", "Esami"], rows: md.distribuzione.filter((d) => d.esami).map((d) => [d.voto === "30L" ? "30 e lode" : d.voto, String(d.esami)]) },
    }));
  }
  if (ins.perAnno.length) {
    out.push(chartFigure({
      title: "Crediti per anno accademico",
      plot: columnChart({ ariaLabel: "Crediti acquisiti per anno accademico", tipName: "CFU", data: ins.perAnno.map((a) => ({ label: a.aa, value: a.cfu })) }),
      table: { headers: ["Anno", "CFU", "Esami"], rows: ins.perAnno.map((a) => [a.aa, String(a.cfu), String(a.esami)]) },
    }));
  }
  if (!out.length) return null;
  return el("div", { class: "section" }, [sectionLabel("Voti e crediti", "30 e lode vale 30, come su Delphi"), el("div", { class: "chart-grid-2" }, out)]);
}

// Target solver: which average the remaining graded CFU need for a target
// degree base. Recomputed in the browser as the target changes.
function statsTarget(ins) {
  const o = ins.obiettivo;
  const md = ins.media;
  if (!o.cfuDaValutare) return null;
  const totale = md.cfuConVoto + o.cfuDaValutare;
  const result = el("div", { class: "stats-target-result" });
  const input = el("input", { class: "input mono", type: "number", min: "66", max: "110", step: "1", value: "105", "aria-label": "Base di laurea obiettivo" });
  const update = () => {
    const target = Math.min(110, Math.max(66, Number(input.value) || 105));
    const media = (target * 30) / 110;
    const needed = (media * totale - md.sommaVotiCfu) / o.cfuDaValutare;
    result.replaceChildren(
      needed > 30
        ? el("p", {}, [el("strong", {}, "Non raggiungibile: "), `anche con 30 in tutti i ${o.cfuDaValutare} CFU restanti arriveresti a ${fmtNum(((md.sommaVotiCfu + 30 * o.cfuDaValutare) / totale) * 110 / 30, 1)}.`])
        : needed < 18
          ? el("p", {}, [el("strong", {}, "Già garantito: "), "anche con 18 in tutti gli esami restanti resteresti sopra l'obiettivo."])
          : el("p", {}, ["Ti serve una media di ", el("strong", { class: "stats-big" }, fmtNum(needed, 2)), ` sui ${o.cfuDaValutare} CFU che restano da valutare.`]),
    );
  };
  input.addEventListener("input", update);
  update();
  return el("div", { class: "section" }, [
    sectionLabel("Obiettivo di laurea", "su 110, prova finale esclusa"),
    el("div", { class: "card sim-card" }, [
      el("label", { class: "flex-row gap-2 mb-3" }, [el("span", {}, "Base di laurea che vuoi raggiungere"), input]),
      result,
      dataTable(
        [{ label: "Esame da sostenere" }, { label: "CFU", num: true }, { label: "Effetto di un punto in più", num: true }],
        o.esami.map((e) => [
          { node: el("div", { class: "row-cell-name" }, [el("strong", {}, txt(e.nome)), e.codice ? el("span", { class: "row-cell-sub" }, e.codice) : null]) },
          { num: true, node: String(e.cfu) },
          { num: true, node: `+${fmtNum((e.cfu / totale) * 110 / 30, 2)} sulla base` },
        ]),
      ),
      el("p", { class: "list-note" }, "Gli esami con più crediti pesano di più: un punto in un esame da 12 CFU vale il doppio che in uno da 6. Tirocinio, idoneità e prova finale non hanno voto e non contano."),
    ]),
  ]);
}

function statsAttempts(ins) {
  const list = ins.tentativi;
  if (!list.length) return null;
  return el("div", { class: "section" }, [
    sectionLabel("Tentativi per esame", "dalle prenotazioni e dal libretto"),
    dataTable(
      [{ label: "Esame" }, { label: "Tentativi", num: true }, { label: "Superato al" }, { label: "Storia" }],
      list.map((s) => [
        { node: el("strong", {}, txt(s.nome)) },
        { num: true, node: String(s.tentativi.filter((t) => t.esito !== "in_programma").length) },
        s.superatoAl ? `${s.superatoAl}° tentativo` : "—",
        { node: el("div", { class: "flex-row gap-2", style: { flexWrap: "wrap" } }, s.tentativi.map((t) =>
          el("span", { class: `tag tag-${ESITO[t.esito].kind}`, title: t.voto ? `Voto ${t.voto}` : "" }, `${t.data ? fmtDate(t.data) : "—"} · ${ESITO[t.esito].text}`))) },
      ]),
    ),
    el("p", { class: "list-note" }, "«Nessun esito» è una prenotazione passata senza voto né bocciatura registrati: ritiro o assenza. Delphi non distingue i due casi."),
  ]);
}

function statsChecklist(ins) {
  return el("div", { class: "section" }, [
    sectionLabel("Verso la laurea"),
    el("div", { class: "list-rows" }, ins.checklist.map((c) => el("div", { class: "list-row" }, [
      el("div", { class: "list-body" }, [
        el("div", { class: "list-title" }, c.voce),
        el("div", { class: "list-sub" }, c.dettaglio),
      ]),
      el("span", { class: `tag tag-${CHECK[c.stato].kind}` }, CHECK[c.stato].text),
    ]))),
  ]);
}

function statsElectives(ins) {
  if (!ins.gruppiScelta.length) return null;
  return el("div", { class: "section" }, [
    sectionLabel("Esami a scelta", "dal tuo piano"),
    el("div", { class: "list-rows" }, ins.gruppiScelta.map((g) => el("div", { class: "list-row" }, [
      el("div", { class: "list-body" }, [
        el("div", { class: "list-sub" }, `${g.anno ? `${g.anno}° anno · ` : ""}${g.gruppo}`),
        ...g.esami.map((e) => el("div", { class: "list-title" }, [
          `${txt(e.nome)} · ${e.cfu ?? "—"} CFU `,
          e.stato === "superato" ? tag("superato", "ok") : e.stato === "in_corso" ? tag("in corso", "info") : tag("da sostenere", "muted"),
        ])),
      ]),
    ]))),
    el("p", { class: "list-note" }, "Il PDF del piano riporta solo l'esame scelto in ogni gruppo. Le alternative compaiono solo nel compositore GOMP."),
  ]);
}

const EVENTO = { immatricolazione: "Immatricolazione", esame: "Esame", fallito: "Non superato", assenza: "Nessun esito", tassa: "Tassa", piano: "Piano" };
function statsTimeline(ins) {
  if (!ins.timeline.length) return null;
  const byAa = new Map();
  for (const e of ins.timeline) {
    const k = e.aa || "—";
    if (!byAa.has(k)) byAa.set(k, []);
    byAa.get(k).push(e);
  }
  return el("div", { class: "section" }, [
    sectionLabel("La tua carriera", `${ins.timeline.length} eventi`),
    ...[...byAa.entries()].reverse().map(([aa, events]) => el("div", { class: "timeline-year" }, [
      el("div", { class: "timeline-aa" }, `Anno accademico ${aa}`),
      el("ol", { class: "timeline" }, [...events].reverse().map((e) => el("li", { class: `timeline-item is-${e.tipo}` }, [
        el("span", { class: "timeline-date mono" }, e.data ? fmtDate(e.data) : ""),
        el("span", { class: "timeline-type" }, EVENTO[e.tipo]),
        el("span", { class: "timeline-title" }, [el("strong", {}, e.titolo), e.dettaglio ? el("span", { class: "muted" }, ` · ${e.dettaglio}`) : null]),
      ]))),
    ])),
  ]);
}

function renderStatistiche(body, ins) {
  setPageHead("statistiche", { title: "Statistiche", subtitle: "Andamento, previsioni e cosa manca alla laurea." });
  const g = ins.progresso;
  const pct = g.cfuTotali ? Math.min(100, Math.round((g.cfuAcquisiti / g.cfuTotali) * 100)) : 0;
  const hero = el("div", { class: "card card--hero hero-lozenge" }, [
    el("div", { class: "stat-row" }, [
      statTile("Crediti", String(g.cfuAcquisiti), `/ ${g.cfuTotali}`),
      statTile("Media ponderata", ins.media.ponderata != null ? fmtNum(ins.media.ponderata, 2) : "—", "su 30"),
      statTile("Base di laurea", ins.media.baseLaurea != null ? fmtNum(ins.media.baseLaurea, 2) : "—", "su 110"),
      statTile("Esami mancanti", g.totaliDaPiano ? String(g.esamiMancanti.length) : "—", g.totaliDaPiano ? `${g.cfuMancanti} CFU` : "piano non disponibile"),
    ]),
    el("div", { class: "meter mt-4", role: "meter", "aria-valuemin": "0", "aria-valuemax": String(g.cfuTotali), "aria-valuenow": String(g.cfuAcquisiti), "aria-label": "Crediti acquisiti" }, [
      el("div", { class: "meter-fill", style: { width: `${pct}%` } }),
    ]),
    el("div", { class: "stat-sub mt-3" }, `${pct}% del percorso`),
  ]);
  body.replaceChildren(...[hero, statsForecast(ins), statsGrades(ins), statsTarget(ins), statsAttempts(ins), statsElectives(ins), statsChecklist(ins), statsTimeline(ins)].filter(Boolean));
}

/* ---------------------------- sessione ---------------------------- */
const FINESTRA = {
  aperta: { text: "prenotazioni aperte", kind: "ok" },
  da_aprire: { text: "prenotazioni non ancora aperte", kind: "info" },
  chiusa: { text: "prenotazioni chiuse", kind: "muted" },
  sconosciuta: { text: "finestra non indicata", kind: "muted" },
};
function renderSessione(body, data) {
  setPageHead("sessione", { title: "Sessione", subtitle: "Un calendario d'esami proposto per i prossimi mesi, dagli appelli pubblicati." });
  // Excluded exams: code → name, kept for the session of the page.
  const escludi = state.sessioneEscludi;
  const qs = escludi.size ? `?escludi=${[...escludi.keys()].join(",")}` : "";
  const toggle = (codice, nome, on) => {
    if (on) escludi.delete(codice); else escludi.set(codice, nome);
    loadView("sessione", false);
  };
  const intro = el("p", { class: "stats-text" }, `Periodo: ${fmtDate(data.da)} – ${fmtDate(data.a)}. Gli esami pesanti sono distanziati di più giorni; quelli che hai già prenotato restano fissi.`);
  if (!data.pianificati.length) {
    body.replaceChildren(intro, emptyState("Nessun appello pubblicato", "Il calendario dei prossimi mesi non ha ancora appelli per gli esami che ti mancano. Riprova quando Delphi pubblica la sessione.", "calendar"),
      ...(escludi.size ? [el("button", { class: "btn btn-ghost btn-sm mt-3", type: "button", onClick: () => { escludi.clear(); loadView("sessione", false); } }, "Includi di nuovo tutti gli esami")] : []));
    return;
  }
  const rows = data.pianificati.map((p) => {
    const f = FINESTRA[p.prenotazione];
    const a = p.appello;
    return el("div", { class: "list-row" }, [
      el("div", { class: "list-icon" }, [icoNode("calendar", 18)]),
      el("div", { class: "list-body" }, [
        el("div", { class: "list-title" }, `${fmtDate(a.dataEsame)}${a.ora ? ` · ${a.ora}` : ""} · ${txt(p.nome)}`),
        el("div", { class: "list-sub" }, `${p.cfu ?? "—"} CFU · appello ${txt(a.appello)} · ${txt(a.aula)} · ${txt(a.docente)}`),
        el("div", { class: "flex-row gap-2 mt-3", style: { flexWrap: "wrap" } }, [
          p.prenotato ? tag("già prenotato", "ok") : tag(f.text, f.kind),
          !p.prenotato && a.inizioPrenotazione ? tag(`dal ${fmtDate(a.inizioPrenotazione)} al ${fmtDate(a.finePrenotazione)}`, "muted") : null,
          p.ravvicinato ? tag("vicino a un altro esame", "warn") : null,
        ]),
        p.alternative.length ? el("div", { class: "list-sub mt-3" }, `Altre date: ${p.alternative.map((x) => fmtDate(x.dataEsame)).join(", ")}`) : null,
      ]),
      p.prenotato ? null : el("button", { class: "btn btn-ghost btn-sm list-action", type: "button", onClick: () => toggle(p.codice, p.nome, false) }, "Escludi"),
    ]);
  });
  const excluded = [...escludi.entries()];
  body.replaceChildren(...[
    intro,
    el("a", { class: "btn btn-secondary btn-sm mb-4", href: `/carriera/sessione.ics${qs}`, download: "sessione-pianificata.ics" }, [icoNode("calendar", 14), el("span", {}, "Aggiungi al calendario")]),
    el("div", { class: "list-rows" }, rows),
    data.senzaAppello.length ? el("div", { class: "section mt-6" }, [
      sectionLabel("Senza appelli nel periodo", `${data.senzaAppello.length} esami`),
      el("p", { class: "muted" }, data.senzaAppello.map((s) => s.nome).join(" · ")),
    ]) : null,
    excluded.length ? el("div", { class: "section mt-6" }, [
      sectionLabel("Esclusi da questa sessione"),
      el("div", { class: "flex-row gap-2", style: { flexWrap: "wrap" } }, excluded.map(([codice, nome]) =>
        el("button", { class: "btn btn-ghost btn-sm", type: "button", onClick: () => toggle(codice, nome, true) }, `Includi ${nome}`))),
    ]) : null,
  ].filter(Boolean));
}

/* ---------------------------- home extras ---------------------------- */

// "In arrivo" on Home: upcoming booked exams, unpaid fees, open records. Each
// source is best-effort; a failing one just contributes no items. These calls
// also warm the other views' caches.
async function loadUpcoming(section) {
  const get = (path) => api(path).then((r) => (r.ok ? r.body : null), () => null);
  const [pren, tasse, verbali, pendenti] = await Promise.all(["/prenotazioni", "/tasse", "/verbali", "/esami-pendenti"].map(get));
  if (!section.isConnected) return;
  const today = todayIso();
  const items = [];
  for (const p of ((pren && pren.prenotazioni) || []).filter((p) => p.dataEsame && p.dataEsame >= today).sort((a, b) => a.dataEsame.localeCompare(b.dataEsame))) {
    items.push({ icon: "calendar", view: "prenotazioni", title: txt(p.insegnamento),
      sub: `Esame ${daysUntil(p.dataEsame)} · ${fmtDate(p.dataEsame)} · appello ${txt(p.appello)}` });
  }
  for (const anno of (tasse && tasse.anni) || []) {
    for (const r of (anno.rate || []).filter((r) => !r.saldato && r.importo > 0)) {
      const late = r.scadenza && r.scadenza < today;
      items.push({ icon: "wallet", view: "tasse", title: `Rata ${txt(r.numero)} da pagare · ${fmtEuro(r.importo)}`,
        sub: r.scadenza ? `${late ? "Scaduta" : "Scade"} il ${fmtDate(r.scadenza)} · ${anno.anno}` : anno.anno, warn: late });
    }
  }
  const nVerbali = ((verbali && verbali.verbali) || []).length;
  if (nVerbali) items.push({ icon: "inbox", view: "verbali", title: nVerbali === 1 ? "1 verbale aperto" : `${nVerbali} verbali aperti`, sub: "Da consultare" });
  const nPendenti = ((pendenti && pendenti.esami) || []).length;
  if (nPendenti) items.push({ icon: "inbox", view: "pendenti", title: nPendenti === 1 ? "1 esame in verbalizzazione" : `${nPendenti} esami in verbalizzazione`, sub: "In attesa del docente" });

  const label = section.firstChild;
  if (!items.length) {
    section.replaceChildren(label, el("p", { class: "muted" }, "Niente in scadenza: nessun esame prenotato, rata da pagare o verbale aperto."));
    return;
  }
  section.replaceChildren(label, el("div", { class: "list-rows" }, items.map((it) =>
    el("a", { class: "list-row upcoming-row", href: "#", onClick: (e) => { e.preventDefault(); activateView(it.view); } }, [
      el("div", { class: "list-icon" }, [icoNode(it.icon, 18)]),
      el("div", { class: "list-body" }, [
        el("div", { class: "list-title" }, it.title),
        el("div", { class: "list-sub" }, it.warn ? el("span", { class: "tag tag-warn" }, it.sub) : it.sub),
      ]),
    ]))));
}

// Weighted average the way Delphi computes it (checked against both test
// accounts): passed exams graded in thirtieths, partial results excluded,
// "30 e lode" counted as 30, weighted by CFU.
function mediaPonderata(rows) {
  const valid = rows.filter((r) => r.cfu > 0 && r.voto >= 18 && r.voto <= 30);
  const cfu = valid.reduce((s, r) => s + r.cfu, 0);
  return cfu ? valid.reduce((s, r) => s + r.voto * r.cfu, 0) / cfu : null;
}

// What-if calculator on Home. Starts from the exams still without a grade
// (stato in_corso) and lets the student add more; nothing leaves the browser.
function gradeSimulator(esami) {
  const passed = esami
    .filter((e) => e.stato === "superato" && e.voto && e.voto.tipo === "trentesimi" && !e.isPartial)
    .map((e) => ({ cfu: e.cfu || 0, voto: e.voto.valore }));
  if (!state.sim) {
    state.sim = esami.filter((e) => e.stato === "in_corso").map((e) => ({ nome: e.nome, cfu: e.cfu || 6, voto: null }));
    if (!state.sim.length) state.sim.push({ nome: "", cfu: 6, voto: null });
  }
  const current = mediaPonderata(passed);
  const fmt = (v) => (v == null ? "—" : v.toFixed(2));
  const result = el("div", { class: "stat-row sim-result" });
  const rowsBox = el("div", { class: "sim-rows" });

  function update() {
    const projected = mediaPonderata([...passed, ...state.sim]);
    const stat = (label, now, next, sub) => el("div", { class: "stat" }, [
      el("div", { class: "stat-label" }, label),
      el("div", {}, [
        el("span", { class: "stat-value" }, fmt(next)),
        el("span", { class: "stat-sub" }, next != null && now != null && next.toFixed(2) !== now.toFixed(2) ? `ora ${fmt(now)}` : sub),
      ]),
    ]);
    result.replaceChildren(
      stat("Media ponderata", current, projected, "su 30"),
      stat("Base di laurea", current && current * 110 / 30, projected && projected * 110 / 30, "su 110"),
    );
  }

  function renderRows() {
    rowsBox.replaceChildren(...state.sim.map((r, i) => el("div", { class: "sim-row" }, [
      el("input", { class: "input", type: "text", placeholder: "Esame", value: r.nome, "aria-label": "Esame",
        onInput: (e) => { r.nome = e.target.value; } }),
      el("input", { class: "input mono", type: "number", min: "1", max: "30", value: String(r.cfu), "aria-label": "CFU",
        onInput: (e) => { r.cfu = Number(e.target.value) || 0; update(); } }),
      (() => {
        const sel = el("select", { class: "select", "aria-label": "Voto",
          onChange: (e) => { r.voto = e.target.value ? Number(e.target.value) : null; update(); } }, [
          el("option", { value: "" }, "Voto"),
          ...Array.from({ length: 13 }, (_, k) => 18 + k).map((v) => el("option", { value: String(v) }, String(v))),
        ]);
        sel.value = r.voto == null ? "" : String(r.voto);
        return sel;
      })(),
      el("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": "Rimuovi",
        onClick: () => { state.sim.splice(i, 1); renderRows(); update(); } }, "Rimuovi"),
    ])));
  }

  renderRows();
  update();
  return el("div", { class: "section mt-6" }, [
    el("div", { class: "section-label" }, [
      el("span", { class: "label-text" }, "Simula la media"),
      el("span", { class: "label-meta muted" }, "30 e lode vale 30"),
    ]),
    el("div", { class: "card sim-card" }, [
      result,
      rowsBox,
      el("button", { class: "btn btn-secondary btn-sm mt-3", type: "button",
        onClick: () => { state.sim.push({ nome: "", cfu: 6, voto: null }); renderRows(); update(); } }, "Aggiungi esame"),
      el("p", { class: "list-note" }, "La base di laurea è la media ponderata in centodecimi. Il voto finale dipende anche dalla prova finale e dal regolamento del tuo corso."),
    ]),
  ]);
}

/* ---------------------------- renderers ---------------------------- */
const RENDERERS = {
  statistiche: renderStatistiche,
  sessione: renderSessione,
  riepilogo(body, data) {
    const h = data.header || {};
    const r = data.rendimento || {};
    const esami = data.esami || [];
    const superati = esami.filter((e) => e.stato === "superato" || e.stato === "idoneo").length;
    const recent = esami
      .filter((e) => e.data)
      .sort((a, b) => (b.data || "").localeCompare(a.data || ""))
      .slice(0, 5);

    // Page header: "Bentornato, Mario" — first name in italic brand-text.
    // (Per the design system, the hero size Fraunces 400 is reserved for the
    // home greeting; we use --t-2xl here so the page header reads at the same
    // size as the other pages.)
    const firstName = (h.studente || "").split(/\s+/)[0] || "studente";
    setPageHead("riepilogo", {
      title: `Bentornato, <em>${esc(firstName)}</em>`,
      subtitle: `Ecco com'è messa la tua carriera in ${txt(h.cdl) || "Tor Vergata"}.`,
    });

    // Hero lozenge — Card with 3 stats: CFU acquisiti, media ponderata,
    // esami sostenuti. Matches the design system's HomeScreen.
    const cfu = r.cfuEsamiValidi ?? 0;
    const mediaPond = r.mediaPonderata;
    const heroLozenge = el("div", { class: "card card--hero hero-lozenge" }, [
      el("div", { class: "stat-row" }, [
        el("div", { class: "stat" }, [
          el("div", { class: "stat-label" }, "CFU acquisiti"),
          el("div", {}, [
            el("span", { class: "stat-value", "data-countup": String(cfu) }, "0"),
            el("span", { class: "stat-sub" }, "/ 180"),
          ]),
        ]),
        el("div", { class: "stat" }, [
          el("div", { class: "stat-label" }, "Media ponderata"),
          el("div", {}, [
            el("span", { class: "stat-value", "data-countup": mediaPond != null ? mediaPond.toFixed(2) : "" }, mediaPond != null ? "0.00" : "—"),
            el("span", { class: "stat-sub" }, "su 30"),
          ]),
        ]),
        el("div", { class: "stat" }, [
          el("div", { class: "stat-label" }, "Esami sostenuti"),
          el("div", {}, [
            el("span", { class: "stat-value" }, String(superati)),
            el("span", { class: "stat-sub" }, `su ${esami.length}`),
          ]),
        ]),
      ]),
    ]);

    // SubLabel + recent list — same data the old "ultimi esami" section
    // showed, just restyled to the design system's SubLabel + flat list.
    const subLabel = el("div", { class: "section-label" }, [
      el("span", { class: "label-text" }, "Ultimi esami"),
      el("a", { class: "label-meta", href: "#", onClick: (e) => { e.preventDefault(); activateView("esami"); } }, "Vedi tutti"),
    ]);
    const recentList = recent.length
      ? el("div", { class: "recent-list" }, recent.map((e, i) =>
          el("div", { class: "recent-row row-in", style: { animationDelay: `${i * 40}ms` } }, [
            el("span", { class: "recent-date" }, fmtDate(e.data)),
            el("div", { class: "recent-name" }, [
              el("strong", {}, txt(e.nome)),
              el("span", { class: "muted" }, e.codice ? `· ${txt(e.codice)}` : ""),
              e.cfu != null ? el("span", { class: "recent-cfu" }, `${e.cfu} CFU`) : null,
            ]),
            el("span", { class: "recent-voto" }, [votoBadge(e)]),
          ])))
      : emptyState("Nessun esame", "Quando registrerai un esame, lo vedrai qui.");

    const upcoming = el("div", { class: "section" }, [
      el("div", { class: "section-label" }, el("span", { class: "label-text" }, "In arrivo")),
      el("div", { class: "skeleton" }, [el("div", { class: "skel-row" }), el("div", { class: "skel-row" })]),
    ]);
    body.replaceChildren(heroLozenge, upcoming, subLabel, recentList, gradeSimulator(esami));
    loadUpcoming(upcoming);

    // Populate the session block (sidebar + drawer) — the riepilogo is the
    // canonical place where the student's name + matricola are known.
    fillSession(h.studente || "—", h.matricola || "—");

    // count-up after mount
    requestAnimationFrame(() => {
      $$("[data-countup]", body).forEach((node) => {
        const v = node.getAttribute("data-countup");
        if (v && !isNaN(Number(v))) {
          const decimals = v.includes(".") ? 2 : 0;
          countUp(node, Number(v), 600, decimals);
        }
      });
    });
  },

  esami(body, data) {
    const esami = data.esami || [];
    const s = data.summary || {};
    setPageHead("esami", { title: "Esami", subtitle: "Libretto completo dei tuoi insegnamenti." });
    if (!state.esamiFilter.aa) syncAaOptions(s.anniAccademici || []);
    if (!esami.length) {
      body.replaceChildren(summaryChips(s), emptyState("Nessun esame", "Prova a togliere un filtro o cerca un altro corso.", "search"));
      return;
    }
    body.replaceChildren(
      summaryChips(s),
      dataTable(
        [{ label: "Esame" }, { label: "SSD" }, { label: "Anno" }, { label: "Data" }, { label: "CFU", num: true }, { label: "Voto" }],
        esami.map((e) => [
          { node: el("div", { class: "row-cell-name" }, [
            el("strong", {}, txt(e.nome)),
            e.codice ? el("span", { class: "row-cell-sub" }, e.codice) : null,
          ]) },
          { mono: true, node: el("span", { class: "mono" }, txt(e.ssd)) },
          { mono: true, node: el("span", { class: "mono" }, txt(e.annoAccademico)) },
          { mono: true, node: el("span", { class: "mono" }, fmtDate(e.data)) },
          { num: true, node: e.cfu != null ? String(e.cfu) : "—" },
          { node: votoBadge(e) },
        ]),
      ),
    );
  },

  appelli(body, data) {
    setPageHead("appelli", { title: "Appelli", subtitle: "Calendario delle prove d'esame: date, aule e finestre di prenotazione." });
    if (!data || !data.length) { body.replaceChildren(emptyState("Nessun appello", "Nessuna prova trovata. All'inizio dell'anno accademico prova anche l'anno precedente.", "calendar")); return; }
    // One "Info" button per course, on its first exam-session row.
    const seen = new Set();
    body.replaceChildren(dataTable(
      [{ label: "Insegnamento" }, { label: "CFU", num: true }, { label: "Sessione" }, { label: "Appello" }, { label: "Data esame" }, { label: "Ora" }, { label: "Aula" }, { label: "Prenotazioni" }, { label: "Stato" }],
      data.map((a) => [
        { node: el("div", {}, [
          el("strong", {}, txt(a.insegnamento)),
          a.idCorIns && !seen.has(a.idCorIns) && seen.add(a.idCorIns) ? infoInsegnamentoButton(a.idCorIns) : null,
        ]) },
        { num: true, node: String(txt(a.cfu)) },
        txt(a.sessione),
        txt(a.appello),
        { mono: true, node: el("span", { class: "mono" }, fmtDate(a.dataEsame)) },
        { mono: true, node: el("span", { class: "mono" }, txt(a.ora)) },
        txt(a.aula),
        { mono: true, node: el("span", { class: "mono" }, `${fmtDate(a.inizioPrenotazione)} → ${fmtDate(a.finePrenotazione)}`) },
        { node: a.stato === "aperto"
            ? el("span", { class: "tag tag-ok" }, "Aperte")
            : a.stato === "chiuso"
              ? el("span", { class: "tag tag-muted" }, "Chiuse")
              : el("span", { class: "tag tag-warn" }, "—") },
      ]),
    ));
  },

  piano(body, data) {
    setPageHead("piano", { title: "Piano", subtitle: "I tuoi piani di studio compilati su GOMP." });
    // GOMP runs inside Delphee through the mirror routes, with the GOMP
    // session held server-side. The composer itself is GOMP's own page.
    const portal = el("div", {}, [
      el("a", { class: "btn btn-ghost btn-sm", href: "/WorkFlow2011/Studenti/Composer/ElencoPiani.aspx", target: "_blank", rel: "noopener" }, [icoNode("external", 14), el("span", {}, "Apri GOMP")]),
      el("p", { class: "list-note" }, "Il compositore del piano è la pagina originale di GOMP, aperta tramite Delphee. Delphee non lo integra ancora: per farlo serve un account con la compilazione aperta e nessun piano già inviato per l'anno, su cui provare senza conseguenze. Se puoi offrirlo e sai programmare, puoi contribuire su GitHub."),
    ]);
    if (!data.piani || !data.piani.length) {
      body.replaceChildren(emptyState("Nessun piano", "Nessun piano di studi compilato. Da GOMP puoi compilarne uno nuovo.", "list"), portal);
      return;
    }
    body.replaceChildren(
      dataTable(
        [{ label: "A/A" }, { label: "Denominazione" }, { label: "Ultima modifica" }, { label: "Status" }, { label: "Piano" }],
        data.piani.map((p) => [
          { mono: true, node: el("span", { class: "mono" }, txt(p.aa)) },
          { node: el("strong", {}, txt(p.denominazione)) },
          { mono: true, node: el("span", { class: "mono" }, txt(p.ultimaModifica)) },
          { node: el("span", { class: p.status === "Approvato" ? "tag tag-ok" : "tag tag-muted" }, txt(p.status)) },
          { node: p.ps
            ? el("a", { class: "btn btn-ghost btn-sm", href: `/piano/pdf?ps=${encodeURIComponent(p.ps)}`, target: "_blank", rel: "noopener" }, [icoNode("download", 14), el("span", {}, "PDF")])
            : el("span", { class: "muted" }, "—") },
        ]),
      ),
      portal,
    );
  },

  tasse(body, data) {
    const anni = data.anni || [];
    const frag = document.createDocumentFragment();

    setPageHead("tasse", { title: "Tasse", subtitle: "Rate, scadenze e codici di pagamento pagoPA." });

    if (data.iscrizione && data.iscrizione.messaggio) {
      frag.append(el("div", { class: "section" }, [
        el("div", { class: "section-label" }, [
          el("span", { class: "label-text" }, `${txt(data.iscrizione.anno)} · ${txt(data.iscrizione.tipo)}`),
        ]),
        el("p", { class: "muted" }, data.iscrizione.messaggio),
      ]));
    }

    for (const anno of anni) {
      const totale = (anno.rate || []).reduce((sum, r) => sum + (r.importo || 0), 0);
      // Year group: title (anno accademico) + isee tag + total. The rate list
      // is rendered as Cards below the year header.
      frag.append(el("div", { class: "tasse-anno" }, [
        el("div", { class: "tasse-anno-head" }, [
          el("div", { class: "tasse-anno-title" }, `Anno accademico ${anno.anno}`),
          anno.isee ? tag(`ISEE ${anno.isee}`, "muted") : null,
          el("div", { class: "tasse-anno-total" }, totale > 0 ? fmtEuro(totale) : ""),
        ]),
        el("div", { class: "rata-list" }, (anno.rate || []).flatMap((rata) => {
          const statusTag = rata.saldato
            ? el("span", { class: "tag tag-ok" }, "Saldata")
            : el("span", { class: "tag tag-warn" }, "Da saldare");
          // Receipt links belong to individual bollettini below (the upstream
          // endpoint requires a bollettinoId). Do not render a dead rate-level
          // receipt or a "Paga" button that has no destination.
          const actionBtn = null;
          // Rata Card — raised tile with the rate name + IUV + importo +
          // status pill + single action. Matches the design system's rate row.
          const rateCard = el("div", { class: "card rata-card" }, [
            el("div", { class: "rata-body" }, [
              el("div", { class: "rata-label" }, `Rata ${txt(rata.numero)}`),
              el("div", { class: "rata-meta" }, [
                rata.scadenza ? el("span", { class: "rata-iuv" }, `Scade ${fmtDate(rata.scadenza)}`) : null,
              ]),
            ]),
            el("div", {}, [
              el("div", { class: "rata-importo" }, rata.importo > 0 ? fmtEuro(rata.importo) : "—"),
            ]),
            el("div", { class: "rata-status" }, [statusTag]),
            actionBtn,
          ]);
          const details = (rata.bollettini || []).map((b) => el("div", { class: "bollettino-detail" }, [
            el("div", { class: "bollettino-voice" }, [el("strong", {}, fmtEuro(b.importo)), b.causale ? ` · causale ${txt(b.causale)}` : ""]),
            b.dataPagamento ? el("div", { class: "bollettino-voice" }, `Pagato il ${fmtDate(b.dataPagamento)}`) : null,
            b.convalidatoPagoPa ? el("span", { class: "tag tag-ok" }, "pagoPA") : null,
            b.iuv ? el("div", { class: "bollettino-iuv" }, `IUV ${b.iuv}`) : null,
            b.ricevuta && b.ricevuta.bollettinoId
              ? el("a", { class: "btn btn-ghost btn-sm", href: `/tasse/ricevuta?bollettinoId=${b.ricevuta.bollettinoId}&rataId=${b.ricevuta.rataId || ""}&aa=${encodeURIComponent(b.ricevuta.aa || "")}`, target: "_blank", rel: "noopener" }, [
                  icoNode("download", 14),
                  el("span", {}, "Ricevuta"),
                ])
              : null,
          ].filter(Boolean)));
          return [rateCard, ...details];
        })),
      ]));
    }

    const altri = data.altriBollettini || [];
    if (altri.length) {
      frag.append(el("div", { class: "section" }, [
        el("div", { class: "section-label" }, [
          el("span", { class: "label-text" }, "Altri bollettini"),
          el("span", { class: "label-meta muted" }, `${altri.length} voci`),
        ]),
        dataTable(
          [{ label: "Causale" }, { label: "Importo", num: true }, { label: "Data" }, { label: "Anno" }, { label: "Ricevuta" }],
          altri.map((a) => [
            txt(a.causale),
            { num: true, node: fmtEuro(a.importo) },
            { mono: true, node: el("span", { class: "mono" }, fmtDate(a.dataPagamento)) },
            { mono: true, node: el("span", { class: "mono" }, txt(a.annoAccademico)) },
            { node: a.ricevuta && a.ricevuta.bollettinoId
              ? el("a", { class: "btn btn-ghost btn-sm", href: `/tasse/ricevuta?bollettinoId=${a.ricevuta.bollettinoId}&rataId=${a.ricevuta.rataId || ""}&aa=${encodeURIComponent(a.ricevuta.aa || "")}`, target: "_blank", rel: "noopener" }, [icoNode("download", 14), el("span", {}, "PDF")])
              : el("span", { class: "muted" }, "—") },
          ]),
        ),
      ]));
    }

    const isee = data.isee || [];
    if (isee.length) {
      frag.append(el("div", { class: "section" }, [
        el("div", { class: "section-label" }, [
          el("span", { class: "label-text" }, "Autorizzazione ISEE-U"),
        ]),
        dataTable(
          [{ label: "Anno" }, { label: "Autorizzazione" }, { label: "Stato" }, { label: "Protocollo" }, { label: "Elaborata il" }],
          isee.map((a) => [
            { mono: true, node: el("span", { class: "mono" }, txt(a.annoAccademico)) },
            txt(a.autorizzazione),
            { node: el("div", {}, [txt(a.stato), a.erroreInps ? el("div", { class: "row-cell-sub" }, `Errore INPS: ${a.erroreInps}`) : null]) },
            { mono: true, node: el("span", { class: "mono" }, txt(a.protocollo)) },
            { mono: true, node: el("span", { class: "mono" }, txt(a.dataElaborazione)) },
          ]),
        ),
      ]));
    }

    if (!frag.childNodes.length) frag.append(emptyState("Nessun dato tasse", "Non risultano pagamenti registrati.", "wallet"));
    body.replaceChildren(frag);
  },

  servizi(body, data) {
    const servizi = data.servizi || [];
    setPageHead("servizi", { title: "Servizi", subtitle: "Attivazioni, codici e link ai servizi online." });
    if (!servizi.length) { body.replaceChildren(emptyState("Nessun servizio", null, "layout-grid")); return; }
    const frag = document.createDocumentFragment();
    for (const s of servizi) {
      const codes = (s.codes || []).map((c) => serviceCodeRow(s, c));
      const actionRow = (s.azione && !(s.codes || []).length) ? genCodeButton(s) : null;
      const details = el("div", { class: "service-details" }, [...codes, actionRow].filter(Boolean));
      const detailsButton = s.path && !codes.length && !actionRow
        ? serviceDetailsButton(s, details)
        : null;
      const linkRow = el("div", { class: "flex-row gap-2 mt-3" }, [
        s.path ? el("a", { class: "btn btn-ghost btn-sm", href: s.path, target: "_blank", rel: "noopener" }, [icoNode("external", 14), el("span", {}, "Apri nel portale")]) : null,
        s.infoLink ? el("a", { class: "btn btn-ghost btn-sm", href: s.infoLink, target: "_blank", rel: "noopener" }, [icoNode("external", 14), el("span", {}, "Maggiori informazioni")]) : null,
      ]);
      const inner = el("div", { class: "list-body" }, [
        el("div", { class: "list-title" }, txt(s.nome)),
        s.descrizione ? el("div", { class: "list-sub" }, s.descrizione) : null,
        details,
        detailsButton,
        (s.path || s.infoLink) ? linkRow : null,
      ].filter(Boolean));
      frag.append(el("div", { class: "list-row" }, [inner]));
    }
    body.replaceChildren(el("div", { class: "list-rows" }, [...frag.childNodes]));
  },

  certificati(body, data) {
    const certs = data.certificati || [];
    setPageHead("certificati", { title: "Certificati", subtitle: "Certificati disponibili per il tuo profilo." });
    if (!certs.length) {
      body.replaceChildren(emptyState("Nessun certificato", "Non risultano certificati disponibili per il tuo profilo.", "award"));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const c of certs) {
      const qs = new URLSearchParams({ path: c.path, ...(c.parametri || {}) }).toString();
      const href = `/certificati/stampa?${qs}`;
      frag.append(el("div", { class: "list-row" }, [
        el("div", { class: "list-icon" }, [icoNode("award", 18)]),
        el("div", { class: "list-body" }, [
          el("div", { class: "list-title" }, txt(c.nome)),
          el("div", { class: "list-sub mono" }, txt(c.path) || ""),
          Object.keys(c.parametri || {}).length
            ? el("div", { class: "list-sub mono" }, Object.entries(c.parametri).map(([k, v]) => `${k}=${v}`).join(" · "))
            : null,
        ]),
        el("a", { class: "btn btn-secondary btn-sm list-action", href, target: "_blank", rel: "noopener" }, [
          icoNode("download", 14),
          el("span", {}, "Stampa"),
        ]),
      ]));
    }
    // Not a certificate, but the same kind of printable document.
    frag.append(el("div", { class: "list-row" }, [
      el("div", { class: "list-icon" }, [icoNode("award", 18)]),
      el("div", { class: "list-body" }, [
        el("div", { class: "list-title" }, "Domanda di iscrizione"),
        el("div", { class: "list-sub" }, "Ristampa dell'ultima domanda di iscrizione o immatricolazione."),
      ]),
      el("a", { class: "btn btn-secondary btn-sm list-action", href: "/iscrizione/domanda", target: "_blank", rel: "noopener" }, [
        icoNode("download", 14),
        el("span", {}, "Stampa"),
      ]),
    ]));
    const list = el("div", { class: "list-rows" }, [...frag.childNodes]);
    body.replaceChildren(
      ...(data.limiteNote ? [el("p", { class: "list-note" }, data.limiteNote)] : []),
      list,
    );
  },

  verbali(body, data) {
    const verbali = (data && data.verbali) || [];
    setPageHead("verbali", { title: "Verbali", subtitle: "Verbali aperti da consultare e chiudere." });
    if (!verbali.length) { body.replaceChildren(emptyState("Tutto in ordine", "Non ci sono verbali aperti da consultare.", "inbox")); return; }
    body.replaceChildren(dataTable(
      [{ label: "Esame" }, { label: "Docente" }, { label: "Anno" }, { label: "Data" }, { label: "CFU", num: true }, { label: "N. verbale" }],
      verbali.map((v) => [
        { node: el("div", { class: "row-cell-name" }, [el("strong", {}, txt(v.nome)), v.numero != null ? el("span", { class: "row-cell-sub" }, `#${v.numero}`) : null]) },
        txt(v.docente),
        { mono: true, node: el("span", { class: "mono" }, txt(v.annoAccademico)) },
        { mono: true, node: el("span", { class: "mono" }, fmtDate(v.data)) },
        { num: true, node: v.cfu != null ? String(v.cfu) : "—" },
        { mono: true, node: el("span", { class: "mono" }, txt(v.verbale)) },
      ]),
    ));
  },

  pendenti(body, data) {
    const esami = (data && data.esami) || [];
    setPageHead("pendenti", { title: "Pendenti", subtitle: "Esami in attesa di verbalizzazione." });
    if (!esami.length) { body.replaceChildren(emptyState("Niente in verbalizzazione", "Non ci sono esami in attesa di chiusura.", "inbox")); return; }
    body.replaceChildren(dataTable(
      [{ label: "Esame" }, { label: "SSD" }, { label: "Anno" }, { label: "Data" }, { label: "CFU", num: true }, { label: "Esito" }, { label: "Voto" }, { label: "N. verbale" }],
      esami.map((e) => [
        { node: el("div", { class: "row-cell-name" }, [el("strong", {}, txt(e.nome)), e.codice ? el("span", { class: "row-cell-sub" }, e.codice) : null]) },
        { mono: true, node: el("span", { class: "mono" }, txt(e.ssd)) },
        { mono: true, node: el("span", { class: "mono" }, txt(e.annoAccademico)) },
        { mono: true, node: el("span", { class: "mono" }, fmtDate(e.data)) },
        { num: true, node: e.cfu != null ? String(e.cfu) : "—" },
        txt(e.esito), txt(e.voto),
        { mono: true, node: el("span", { class: "mono" }, txt(e.verbale)) },
      ]),
    ));
  },

  // Read-only: enrolling stays in the portal (the wrapper never submits it).
  corsi(body, data) {
    const corsi = (data && data.corsi) || [];
    setPageHead("corsi", { title: "Corsi", subtitle: "Insegnamenti a cui puoi iscriverti per seguire il corso." });
    const portal = el("a", { class: "btn btn-ghost btn-sm mt-3", href: "/totem/jsp/IscCorsiStudente/menuIscrizioni.jsp", target: "_blank", rel: "noopener" }, [icoNode("external", 14), el("span", {}, "Iscriviti nel portale")]);
    if (!corsi.length) { body.replaceChildren(emptyState("Nessun corso", "Al momento non ci sono corsi a cui iscriversi.", "book"), portal); return; }
    body.replaceChildren(
      dataTable(
        [{ label: "Insegnamento" }, { label: "Anno" }, { label: "CFU", num: true }, { label: "Docente" }, { label: "Sessione o ciclo" }, { label: "Classe virtuale" }],
        corsi.map((c) => [
          { node: el("div", { class: "row-cell-name" }, [el("strong", {}, txt(c.nome)), c.codice ? el("span", { class: "row-cell-sub" }, c.codice) : null]) },
          { mono: true, node: el("span", { class: "mono" }, txt(c.annoAccademico)) },
          { num: true, node: c.cfu != null ? String(c.cfu) : "—" },
          txt(c.docente),
          txt(c.sessione),
          txt(c.classeVirtuale),
        ]),
      ),
      portal,
    );
  },

  prenotazioni(body, data) {
    const list = (data && data.prenotazioni) || [];
    setPageHead("prenotazioni", { title: "Prenotazioni", subtitle: "Le tue prenotazioni agli appelli, attive e passate." });
    if (!list.length) { body.replaceChildren(emptyState("Nessuna prenotazione", "Non risultano prenotazioni agli esami.", "calendar")); return; }
    const hasUpcoming = list.some((p) => p.dataEsame && p.dataEsame >= todayIso());
    const exportLink = hasUpcoming
      ? el("a", { class: "btn btn-secondary btn-sm mb-4", href: "/prenotazioni/calendario.ics", download: "esami-prenotati.ics" }, [icoNode("calendar", 14), el("span", {}, "Aggiungi al calendario")])
      : null;
    body.replaceChildren(...[exportLink].filter(Boolean), el("div", { class: "list-rows" }, list.map((p) => {
      const details = el("div", { class: "service-details" });
      const ricevuta = p.ref
        ? el("a", { class: "btn btn-ghost btn-sm", href: `/prenotazioni/ricevuta?${new URLSearchParams(p.ref)}`, target: "_blank", rel: "noopener" }, [icoNode("download", 14), el("span", {}, "Ricevuta")])
        : null;
      return el("div", { class: "list-row" }, [
        el("div", { class: "list-icon" }, [icoNode("calendar", 18)]),
        el("div", { class: "list-body" }, [
          el("div", { class: "list-title" }, txt(p.insegnamento)),
          el("div", { class: "list-sub" }, [
            `${fmtDate(p.dataEsame)} · appello ${txt(p.appello)} · ${txt(p.tipologia)} · ${txt(p.docente)}`,
          ]),
          el("div", { class: "flex-row gap-2 mt-3", style: { flexWrap: "wrap" } }, [
            p.attiva ? tag("Attiva", "ok") : tag("Chiusa", "muted"),
            p.posizione != null ? tag(`${p.posizione}° su ${p.prenotati}`, "muted") : null,
            p.verbale ? tag(`Verbale ${p.verbale}`, "info") : null,
          ]),
          details,
          el("div", { class: "flex-row gap-2 mt-3" }, [
            p.ref ? prenotazioneDetailsButton(p.ref, details) : null,
            ricevuta,
          ]),
        ]),
      ]);
    })));
  },

  anagrafica(body, data) {
    const fullName = [data.nome, data.cognome].filter(Boolean).map(txt).join(" ");
    setPageHead("anagrafica", { title: "Anagrafica", subtitle: "I tuoi dati personali e di carriera." });
    const head = el("div", { class: "profile-card fade-in" }, [
      data.fotoUrl ? el("img", { class: "profile-photo", src: data.fotoUrl, alt: "" }) : null,
      el("div", { class: "profile-body" }, [
        el("div", { class: "profile-name" }, fullName || "—"),
        el("div", { class: "profile-meta" }, [
          el("span", {}, [el("span", { class: "meta-key" }, "CF · "), txt(data.codiceFiscale)]),
          el("span", {}, [el("span", { class: "meta-key" }, "Matricola · "), txt(data.matricola)]),
          data.statoCarriera ? tag(data.statoCarriera, data.statoCarriera.toLowerCase().includes("conclusa") || data.statoCarriera.toLowerCase().includes("attiv") ? "ok" : "muted") : null,
        ]),
      ]),
    ]);

    const sections = el("div", { class: "section mt-6" }, [
      el("div", { class: "section-label" }, el("span", { class: "label-text" }, "Contatti e residenza")),
      el("dl", { class: "dl" }, [
        el("dt", {}, "Email"), el("dd", {}, txt(data.email)),
        el("dt", {}, "Cellulare"), el("dd", {}, txt(data.cellulare)),
        el("dt", {}, "Data di nascita"), el("dd", {}, `${fmtDate(data.dataNascita)} · ${txt(data.comuneNascita)} (${txt(data.provinciaNascita)})`),
        el("dt", {}, "Cittadinanza"), el("dd", {}, txt(data.nazioneCittadinanza)),
      ]),
      el("h3", { class: "section-title mt-6", style: { fontSize: "var(--t-md)", marginBottom: "var(--sp-3)" } }, "Residenza"),
      el("dl", { class: "dl" }, addrRows(data.residenza)),
      el("h3", { class: "section-title mt-6", style: { fontSize: "var(--t-md)", marginBottom: "var(--sp-3)" } }, "Domicilio"),
      el("dl", { class: "dl" }, addrRows(data.domicilio)),
    ]);

    const carriera = el("div", { class: "section mt-6" }, [
      el("div", { class: "section-label" }, el("span", { class: "label-text" }, "Carriera")),
      el("dl", { class: "dl" }, [
        el("dt", {}, "Corso"), el("dd", {}, txt(data.corso)),
        el("dt", {}, "Codice corso"), el("dd", {}, txt(data.codiceCorso)),
        el("dt", {}, "Anno di corso"), el("dd", {}, txt(data.annoCorsoLabel)),
        el("dt", {}, "Anno accademico immatricolazione"), el("dd", {}, txt(data.aaImmatricolazione)),
        el("dt", {}, "Ultima iscrizione"), el("dd", {}, txt(data.aaUltimaIscrizione)),
      ]),
    ]);

    const laurea = data.laurea ? el("div", { class: "section mt-6" }, [
      el("div", { class: "section-label" }, el("span", { class: "label-text" }, "Laurea")),
      el("dl", { class: "dl" }, [
        el("dt", {}, "Corso"), el("dd", {}, txt(data.laurea.corso)),
        el("dt", {}, "Data"), el("dd", {}, fmtDate(data.laurea.data)),
        el("dt", {}, "Votazione"), el("dd", {}, txt(data.laurea.votazione)),
      ]),
    ]) : null;

    body.replaceChildren(...[head, sections, carriera, laurea].filter(Boolean));
  },
};

function addrRows(a) {
  a = a || {};
  return [
    el("dt", {}, "Indirizzo"), el("dd", {}, txt(a.indirizzo)),
    el("dt", {}, "Comune"), el("dd", {}, `${txt(a.comune)} (${txt(a.provincia)})`),
    el("dt", {}, "CAP"), el("dd", {}, txt(a.cap)),
    el("dt", {}, "Telefono"), el("dd", {}, txt(a.telefono)),
  ];
}

function serviceCodeRow(s, c) {
  const isUrl = /^https?:\/\//i.test(c.value);
  const valueNode = isUrl
    ? el("a", { class: "code-value is-link", href: c.value, target: "_blank", rel: "noopener" }, c.value)
    : el("code", { class: "code-value" }, c.value);
  const copyBtn = el("button", { class: "btn btn-ghost btn-sm", type: "button", title: "Copia",
    onClick: async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard?.writeText(c.value);
        const orig = btn.innerHTML;
        btn.replaceChildren(el("span", {}, "Copiato"));
        setTimeout(() => { btn.innerHTML = orig; }, 1200);
      } catch { toast("Impossibile copiare", "bad"); }
    }
  }, [icoNode("copy", 14), el("span", {}, "Copia")]);
  return el("div", { class: "code-row mt-3" }, [
    el("div", { class: "code-label" }, c.label || (isUrl ? "Link di attivazione" : "Codice di attivazione")),
    valueNode,
    copyBtn,
  ]);
}

function genCodeButton(s) {
  return el("button", { class: "btn btn-secondary btn-sm mt-3", type: "button",
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const orig = btn.innerHTML;
      btn.replaceChildren(el("span", {}, "Generazione…"));
      const r = await api(`/servizi/genera?path=${encodeURIComponent(s.azione.path)}&ctx=${encodeURIComponent(s.path || "")}`, { method: "POST" });
      if (r.ok && r.body && r.body.code) {
        btn.replaceWith(serviceCodeRow(s, { label: null, value: r.body.code }));
      } else {
        btn.disabled = false;
        btn.innerHTML = orig;
        toast(describeError(r.body), "bad");
      }
    }
  }, [icoNode("zap", 14), el("span", {}, s.azione.label)]);
}

function serviceDetailsButton(s, target) {
  return el("button", { class: "btn btn-secondary btn-sm mt-3", type: "button",
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.replaceChildren(el("span", {}, "Caricamento…"));
      const r = await api(`/servizi/dettaglio?path=${encodeURIComponent(s.path)}`);
      if (!r.ok) {
        btn.disabled = false;
        btn.replaceChildren(icoNode("zap", 14), el("span", {}, "Mostra dettagli"));
        toast(describeError(r.body), "bad");
        return;
      }
      const rows = (r.body.codes || []).map((c) => serviceCodeRow(s, c));
      if (r.body.azione && !rows.length) {
        s.azione = r.body.azione;
        rows.push(genCodeButton(s));
      }
      if (!rows.length) rows.push(el("div", { class: "list-sub mt-3" }, "Nessun codice disponibile."));
      target.replaceChildren(...rows);
      btn.remove();
    }
  }, [icoNode("zap", 14), el("span", {}, "Mostra dettagli")]);
}

// Syllabus for one course, shown in a full-width row under the clicked one.
function infoInsegnamentoButton(idCorIns) {
  return el("button", { class: "btn btn-ghost btn-sm mt-3", type: "button",
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.replaceChildren(el("span", {}, "Caricamento…"));
      const r = await api(`/appelli/info?idCorIns=${encodeURIComponent(idCorIns)}`);
      if (!r.ok) {
        btn.disabled = false;
        btn.replaceChildren(icoNode("book", 14), el("span", {}, "Info corso"));
        toast(describeError(r.body), "bad");
        return;
      }
      const d = r.body;
      const block = (k, v) => v ? [el("dt", {}, k), el("dd", {}, v)] : [];
      const rows = [
        ...block("Obiettivi", d.obiettivi),
        ...block("Prerequisiti", d.prerequisiti),
        ...block("Metodi di insegnamento", d.metodiInsegnamento),
        ...block("Metodi di valutazione", d.metodiValutazione),
        ...block("Programma", d.programma),
        ...(d.moduli || []).flatMap((m) => block(
          `${txt(m.nome)} · ${m.cfu ?? "—"} CFU · ${txt(m.docente)}`,
          m.programma || "Programma non indicato.",
        )),
      ];
      const tr = btn.closest("tr");
      const cell = el("td", { colspan: String(tr.children.length) }, rows.length
        ? el("dl", { class: "dl dl-prose" }, rows)
        : el("p", { class: "muted" }, "Il docente non ha pubblicato informazioni su questo corso."));
      tr.after(el("tr", {}, cell));
      btn.remove();
    }
  }, [icoNode("book", 14), el("span", {}, "Info corso")]);
}

function prenotazioneDetailsButton(ref, target) {
  return el("button", { class: "btn btn-secondary btn-sm", type: "button",
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.replaceChildren(el("span", {}, "Caricamento…"));
      const r = await api(`/prenotazioni/dossier?${new URLSearchParams(ref)}`);
      if (!r.ok) {
        btn.disabled = false;
        btn.replaceChildren(icoNode("zap", 14), el("span", {}, "Dettagli"));
        toast(describeError(r.body), "bad");
        return;
      }
      // Dossier: booking details, then past attempts and the syllabus.
      const { dettaglio: d, tentativi, info, giorni } = r.body;
      const rows = [
        ["Data e ora", `${fmtDate(d.dataEsame)}${d.orario ? ` · ${d.orario}` : ""}${giorni != null && giorni >= 0 ? ` · ${giorni === 0 ? "oggi" : giorni === 1 ? "domani" : `tra ${giorni} giorni`}` : ""}`],
        ["Modalità", d.modalita],
        ["Sessione", d.sessione],
        ["Edificio", d.edificio],
        ["Aula", d.aula],
        ["Prenotazioni", `${fmtDate(d.inizioPrenotazione)} – ${fmtDate(d.finePrenotazione)}`],
        ["Numero prenotazione", d.numeroPrenotazione],
        ["Comunicazioni", d.comunicazioni],
        ["Moduli", (d.moduli || []).map((m) => `${txt(m.nome)} (${txt(m.ssd)}, ${m.cfu ?? "—"} CFU)`).join(" · ") || null],
      ];
      const past = tentativi ? tentativi.tentativi.filter((t) => t.esito !== "in_programma") : [];
      const syllabus = info ? [
        ["Obiettivi", info.obiettivi], ["Metodi di valutazione", info.metodiValutazione], ["Programma", info.programma],
        ...(info.moduli || []).map((m) => [txt(m.nome), m.programma]),
      ].filter(([, v]) => v) : [];
      target.replaceChildren(...[
        el("dl", { class: "dl mt-3" }, rows.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, txt(v))])),
        past.length ? el("div", { class: "mt-4" }, [
          el("div", { class: "list-sub mb-3" }, `Tentativi precedenti${tentativi.superatoAl ? ` · superato al ${tentativi.superatoAl}°` : ""}`),
          el("div", { class: "flex-row gap-2", style: { flexWrap: "wrap" } }, past.map((t) =>
            el("span", { class: `tag tag-${ESITO[t.esito].kind}` }, `${t.data ? fmtDate(t.data) : "—"} · ${ESITO[t.esito].text}${t.voto ? ` · ${t.voto}` : ""}`))),
        ]) : null,
        syllabus.length ? el("details", { class: "mt-4" }, [
          el("summary", { class: "list-sub" }, "Programma del corso"),
          el("dl", { class: "dl dl-prose mt-3" }, syllabus.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
        ]) : null,
      ].filter(Boolean));
      btn.remove();
    }
  }, [icoNode("zap", 14), el("span", {}, "Dettagli")]);
}

function syncAaOptions(anni) {
  const sel = $('[data-esami-filter] select[name="aa"]');
  if (!sel) return;
  const current = sel.value;
  sel.replaceChildren(
    el("option", { value: "" }, "Tutti gli anni"),
    ...anni.map((a) => el("option", { value: a }, a)),
  );
  sel.value = current;
}

/* ---------------------------- events ---------------------------- */
function wireEvents() {
  $$("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
    toggleTheme();
    const label = $("[data-theme-label]");
    if (label) label.textContent = resolvedTheme() === "dark" ? "Tema chiaro" : "Tema scuro";
  }));

  $$("[data-nav]").forEach((b) => b.addEventListener("click", () => {
    activateView(b.dataset.nav);
    closeDrawer();
  }));

  // Mobile drawer
  const drawer = $("[data-drawer]");
  const drawerBackdrop = $("[data-drawer-backdrop]");
  const drawerToggle = $("[data-drawer-toggle]");
  const drawerClose = $("[data-drawer-close]");
  if (drawer && drawerToggle) {
    drawerToggle.addEventListener("click", () => {
      drawer.hidden ? openDrawer() : closeDrawer();
    });
    drawerBackdrop?.addEventListener("click", closeDrawer);
    drawerClose?.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer && !drawer.hidden) closeDrawer(); });
  }

  const refreshView = (btn, id) => {
    btn.classList.remove("spinning");
    void btn.offsetWidth; // restart the spin on rapid re-clicks
    btn.classList.add("spinning");
    btn.addEventListener("animationend", () => btn.classList.remove("spinning"), { once: true });
    if (id === "riepilogo" || id === "esami") state.carriera = null;
    loadView(id, true);
  };
  $$("[data-refresh]").forEach((btn) => btn.addEventListener("click", () => refreshView(btn, btn.dataset.refresh)));
  const headerRefresh = $("[data-refresh-current]");
  headerRefresh?.addEventListener("click", () => refreshView(headerRefresh, state.activeView));

  const ef = $("[data-esami-filter]");
  if (ef) ef.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(ef);
    state.esamiFilter = { nome: fd.get("nome") || "", ssd: fd.get("ssd") || "", aa: fd.get("aa") || "", stato: fd.get("stato") || "" };
    loadView("esami", true);
  });

  const as = $("[data-appelli-search]");
  if (as) as.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(as);
    state.appelliFilter = { anno: fd.get("anno") || "", sessione: fd.get("sessione") || "TUTTE" };
    loadView("appelli", true);
  });

  $("[data-login-form]").addEventListener("submit", onLogin);
  $$("[data-logout]").forEach((b) => b.addEventListener("click", onLogout));

  /* Keep the card's right-of-center offset in sync with viewport size so
   * the idle position stays anchored to the right when the window resizes. */
  window.addEventListener("resize", () => {
    const page = $("[data-login]");
    if (page && !page.hidden) layoutLoginCard();
    positionNavIndicator();
  });
}

function openDrawer() {
  const drawer = $("[data-drawer]");
  const backdrop = $("[data-drawer-backdrop]");
  const toggle = $("[data-drawer-toggle]");
  if (!drawer) return;
  drawer.hidden = false;
  if (backdrop) backdrop.hidden = false;
  toggle?.setAttribute("aria-expanded", "true");
  // lock body scroll
  document.body.style.overflow = "hidden";
  // focus the close button for keyboard users
  requestAnimationFrame(() => $("[data-drawer-close]")?.focus());
}
function closeDrawer() {
  const drawer = $("[data-drawer]");
  const backdrop = $("[data-drawer-backdrop]");
  const toggle = $("[data-drawer-toggle]");
  if (!drawer) return;
  drawer.hidden = true;
  if (backdrop) backdrop.hidden = true;
  toggle?.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
  toggle?.focus();
}

/* Login is slow (Delphi's two-step login, 2s throttle gaps, retries), so the
 * submitting button cycles honest staged copy instead of a frozen label —
 * paired with the CSS sheen + mark breathing, the wait never reads as stuck.
 * Stages map to what actually happens upstream; the last one just tells the
 * truth about Delphi. Time-based because a single fetch gives no progress. */
const LOGIN_STAGES = [
  { text: "Connessione a Delphi…",  hold: 1900 },
  { text: "Verifica credenziali…",  hold: 2800 },
  { text: "Ci siamo quasi…",        hold: 4500 },
  { text: "Delphi ci mette un po'…", hold: Infinity },
];
let loginStageTimer = null;
function startLoginProgress() {
  const label = $("[data-login-label]");
  if (!label) return;
  stopLoginProgress();
  let i = 0;
  const apply = () => {
    label.textContent = LOGIN_STAGES[i].text;
    const { hold } = LOGIN_STAGES[i];
    if (i < LOGIN_STAGES.length - 1 && Number.isFinite(hold)) {
      loginStageTimer = setTimeout(() => { i += 1; apply(); }, hold);
    }
  };
  apply();
}
function stopLoginProgress() {
  if (loginStageTimer) { clearTimeout(loginStageTimer); loginStageTimer = null; }
  const label = $("[data-login-label]");
  if (label) label.textContent = "Accedi";
}

async function onLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const submit = $("[data-login-submit]");
  const errEl = $("[data-login-error]");
  const page = $("[data-login]");
  errEl.hidden = true;
  submit.disabled = true;
  /* Trigger the in-flight transition: copy fades, card slides to center, and
   * the staged-copy cycler + CSS sheen/breathing signal live progress. */
  page?.classList.add("login-page--submitting");
  startLoginProgress();
  const fd = new FormData(form);
  let ok, body;
  try {
    ({ ok, body } = await api("/session/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matricola: fd.get("matricola"), password: fd.get("password") }),
    }));
  } catch (err) {
    ok = false; body = { error: "network" };
  }
  if (ok && body.token && body.state === "logged_in") {
    // In memory only — never localStorage. The /totem/* mirror serves Delphi's
    // own HTML on this origin, so anything persisted here is readable by a
    // script in a portal page. The httpOnly dw_token cookie survives reloads
    // instead, and the browser attaches it to these same-origin fetches.
    state.token = body.token;
    stopLoginProgress();
    enterApp(body); toast("Bentornato.", "ok");
    return;
  }
  /* Auth failed — restore the idle state so the user can try again. */
  page?.classList.remove("login-page--submitting");
  submit.disabled = false;
  stopLoginProgress();
  errEl.textContent = describeError(body);
  errEl.hidden = false;
}

async function onLogout() {
  const { body } = await api("/session/logout", { method: "POST" });
  state.token = "";
  state.loaded.clear();
  state.loadGeneration.clear();
  state.carriera = null;
  show("login");
}

function enterApp(status) {
  show("app");
  state.matricola = status.matricola || "";
  $$("[data-logout]").forEach((b) => b.hidden = false);
  requestAnimationFrame(() => activateView("riepilogo", { scrollTop: true, force: false, instant: true }));
}

/* ---------------------------- bootstrap ---------------------------- */
async function bootstrap() {
  wireEvents();
  show("loading");
  try {
    // These calls are independent; doing them together removes one round trip
    // from startup. The cookie resolves the session after a reload.
    const [cfg, status] = await Promise.all([api("/config"), api("/session/status")]);
    if (cfg.ok) state.version = cfg.body.version;
    if (status.ok && status.body.state === "logged_in") {
      enterApp(status.body);
    } else {
      state.token = "";
      show("login");
    }
  } catch {
    show("login");
    toast("Impossibile contattare il server", "bad");
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap);
else bootstrap();
