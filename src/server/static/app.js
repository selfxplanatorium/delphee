// Delphi Wrapper SPA controller — vanilla JS, no framework, no build step.
//
// Responsibilities: theme toggle, session gate (login vs app), sidebar nav,
// one lazy loader + renderer per view. Renderers build DOM via el() so there's
// no innerHTML injection of server data. Errors map to Italian via describeError;
// X-Cache-Stale surfaces as a per-page tag.

const NAV = ["riepilogo", "esami", "verbali", "pendenti", "piano", "appelli", "tasse", "certificati", "servizi", "anagrafica"];

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
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---------------------------- helpers ---------------------------- */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
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
  tasse: async (force) => { const r = await api(refreshed("/tasse", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  servizi: async (force) => { const r = await api(refreshed("/servizi", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  certificati: async (force) => { const r = await api(refreshed("/certificati", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  anagrafica: async (force) => { const r = await api(refreshed("/anagrafica", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  verbali: async (force) => { const r = await api(refreshed("/verbali", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
  pendenti: async (force) => { const r = await api(refreshed("/esami-pendenti", force)); if (!r.ok) throw r.body; return { data: r.body, stale: r.stale }; },
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

/* ---------------------------- renderers ---------------------------- */
const RENDERERS = {
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

    body.replaceChildren(heroLozenge, subLabel, recentList);

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
    body.replaceChildren(dataTable(
      [{ label: "Insegnamento" }, { label: "CFU", num: true }, { label: "Sessione" }, { label: "Appello" }, { label: "Data esame" }, { label: "Ora" }, { label: "Aula" }, { label: "Prenotazioni" }, { label: "Stato" }],
      data.map((a) => [
        { node: el("strong", {}, txt(a.insegnamento)) },
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
    const portal = data.composerUrl
      ? el("a", { class: "btn btn-ghost btn-sm", href: data.composerUrl, target: "_blank", rel: "noopener" }, [icoNode("external", 14), el("span", {}, "Apri nel portale")])
      : null;
    if (!data.piani || !data.piani.length) {
      body.replaceChildren(emptyState("Nessun piano", "Nessun piano di studi compilato. Dal portale puoi compilarne uno nuovo.", "list"), portal ?? "");
      return;
    }
    body.replaceChildren(
      dataTable(
        [{ label: "A/A" }, { label: "Denominazione" }, { label: "Ultima modifica" }, { label: "Status" }],
        data.piani.map((p) => [
          { mono: true, node: el("span", { class: "mono" }, txt(p.aa)) },
          { node: el("strong", {}, txt(p.denominazione)) },
          { mono: true, node: el("span", { class: "mono" }, txt(p.ultimaModifica)) },
          { node: el("span", { class: p.status === "Approvato" ? "tag tag-ok" : "tag tag-muted" }, txt(p.status)) },
        ]),
      ),
      portal ?? "",
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
