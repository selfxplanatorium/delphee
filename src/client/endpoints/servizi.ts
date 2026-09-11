import { load, cleanText, orNull } from "./util.js";
import type { ServiziResponse, Servizio, ServizioCode } from "../../types.js";

// Parser for sStudentiAttivaServizi.jsp. The page is an <ol> of <li>s where each
// li has:
//   - a <div> wrapping the activation anchor. The link TEXT is the service name;
//     the link HREF is the activation flow — resolved to an absolute /totem path
//     the "Apri nel portale" link points at (the wrapper's /totem/* reverse-proxy
//     serves it with the session attached).
//   - zero or more <i> paragraphs of description text; the last one may end
//     in a "QUI" anchor to an external docs URL — surfaced as `infoLink`.
//
// We surface the activation path and the external docs URL.

const PAGE_BASE = "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp";

// Activation "values" come in two shapes, depending on the service:
//
//   1. Numeric code (MatLab): 4–5 groups of 4–6 digits separated by
//      hyphens, e.g. `NNNNN-NNNNN-NNNNN-NNNNN-NNNNN`. Lives in a
//      `<td class="titolotabella"><b>…</b></td>` cell.
//
//   2. Activation URL with a hex token (Mathematica / Wolfram):
//      `https://user.wolfram.com/portal/requestAK/<40-hex-chars>`.
//      The user clicks it to claim their licence.
//
// Office365 (and similar) expose no code or URL on the activation page
// — just a menu of post-activation actions. The wrapper surfaces those
// as plain "Apri nel portale" links.
const NUMERIC_CODE = /\b(\d{4,6}(-\d{4,6}){2,4})\b/;
const ACTIVATION_URL = /^https?:\/\/[^/]+\/[^?#]*\/[a-f0-9]{16,}/i;
// A `?message=` activation code: alphanumeric with optional hyphens — MatLab's
// hyphenated groups or National Instruments' `D11L…` style. Excludes path-like
// values (the `.jsp` of a `next=` target fails the anchored match).
const MESSAGE_CODE = /^[A-Za-z0-9][\w-]{4,}$/;

function pickCode($: ReturnType<typeof load>): string | null {
  // Pass 1: numeric code in any cell whose whole text is the code.
  let definitive: string | null = null;
  $("td").each((_, td) => {
    const t = cleanText($(td).text());
    if (t !== NUMERIC_CODE.exec(t)?.[1]) return;
    definitive = t;
    return false;
  });
  if (definitive) return definitive;

  // Pass 2: any long numeric code on the page (cell, bold, green).
  let best: string | null = null;
  $("td, b, strong, font[color]").each((_, el) => {
    const m = cleanText($(el).text()).match(NUMERIC_CODE);
    if (!m || !m[1]) return;
    if (!best || m[1].length > best.length) best = m[1];
  });
  if (best) return best;

  // Pass 3: activation URL with a long hex/octet token in the path
  // (Wolfram Mathematica's licence claim link). Prefer the most
  // activation-specific URL.
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    if (ACTIVATION_URL.test(href)) { best = href; return false; }
  });
  return best;
}

// extractCode is exported so the api can run it on the activation-page
// response for any service whose `?message=` was absent. Pure function.
export function extractCode(html: string): string | null {
  return pickCode(load(html));
}

// extractCodes resolves every code on an activation page, handling the two
// shapes Delphi uses for the inner page:
//   1. A sub-list of code services — National Instruments lists LabVIEW and
//      Multisim, each an OperazioneOK.jsp?message=CODE anchor. We surface all
//      of them, labelled by item name.
//   2. A single code/URL (MatLab cell, Wolfram claim link) → one unlabelled
//      entry. Empty when the page is a flow/status page with no code.
export function extractCodes(html: string): ServizioCode[] {
  const $ = load(html);
  const sub: ServizioCode[] = [];
  $("ol li a[href], ul li a[href]").each((_, a) => {
    const m = /[?&]message=([^&]+)/.exec($(a).attr("href") || "");
    if (!m) return;
    const value = decodeURIComponent(m[1]!);
    if (MESSAGE_CODE.test(value)) sub.push({ label: cleanText($(a).text()) || null, value });
  });
  if (sub.length) return sub;
  const one = pickCode($);
  return one ? [{ label: null, value: one }] : [];
}

// Detect an on-demand "Genera codice" action on an activation page — a button
// whose onClick navigates to a `?Genera=…` URL (MyCampusXApp). Returns the
// resolved Delphi path so the wrapper can trigger it server-side. We match the
// "genera" label (not "Indietro"/"Reset") to avoid grabbing the wrong button.
export function extractAzione(html: string, baseUrl: string): { label: string; path: string } | null {
  const $ = load(html);
  const base = new URL(PAGE_BASE, baseUrl);
  let found: { label: string; path: string } | null = null;
  $("input[type=button], button, a[href]").each((_, el) => {
    const $el = $(el);
    const label = cleanText($el.attr("value") || $el.text());
    if (!/genera/i.test(label)) return;
    const nav = $el.attr("onclick") || $el.attr("href") || "";
    const target = /['"]([^'"]*\?[^'"]*Genera=[^'"]*)['"]/i.exec(nav)?.[1]
      ?? (/Genera=/i.test($el.attr("href") || "") ? $el.attr("href") : undefined);
    if (!target) return;
    try {
      const u = new URL(target, base);
      found = { label, path: u.pathname + u.search };
      return false;
    } catch { /* skip unparseable */ }
  });
  return found;
}

// Read the code off a "Genera codice" result page: Delphi renders
// "Il tuo codice è <TOKEN>" where the token is 4-6 alphanumeric chars.
// Returns the token or null.
export function extractGeneratedCode(html: string): string | null {
  const text = cleanText(load(html)("body").text());
  return /tuo codice[^A-Za-z0-9]*([A-Za-z0-9]{4,})/i.exec(text)?.[1] ?? null;
}

export function parse(html: string, baseUrl: string): ServiziResponse {
  const $ = load(html);
  const base = new URL(PAGE_BASE, baseUrl);
  const out: Servizio[] = [];

  let list = $("td.msggenerico ol").first();
  if (!list.length) list = $("ol").first();
  if (!list.length) list = $("ul").first();
  if (!list.length) return { servizi: out };

  list.children("li").each((_, li) => {
    const $li = $(li);
    const anchor = $li.find("a").first();
    const nome = cleanText(anchor.text());
    if (!nome) return;

    // Activation href: stored as the relative path the wrapper can re-issue
    // through the proxy endpoint. Resolve it against the page base so the
    // path is unambiguous (e.g. "../emailMicrosoft/menuEmail.jsp" →
    // "/totem/jsp/emailMicrosoft/menuEmail.jsp"). We also peek for an
    // activation code in the `message=` query param (MatLab's OperazioneOK
    // carries the code in the URL itself, so we don't need to fetch the
    // page just to read it).
    let path: string | null = null;
    const codes: ServizioCode[] = [];
    const href = anchor.attr("href");
    if (href) {
      try {
        const u = new URL(href, base);
        path = u.pathname + u.search;
        const message = u.searchParams.get("message");
        if (message && MESSAGE_CODE.test(message)) codes.push({ label: null, value: message });
      } catch { /* ignore bad href */ }
    }

    // The descriptive <i> blocks. Capture any external link in them as
    // infoLink; join the rest as the descrizione.
    const iTexts: string[] = [];
    let infoLink: string | null = null;
    $li.find("i").each((__, i) => {
      const $i = $(i);
      $i.find("a").each((___, a) => {
        const aHref = $(a).attr("href");
        if (!aHref) return;
        try {
          const u = new URL(aHref, base);
          if (/^https?:\/\//i.test(u.toString())) infoLink = u.toString();
        } catch { /* relative junk */ }
      });
      const t = cleanText($i.text());
      if (t) iTexts.push(t);
    });
    const descrizione = iTexts.length ? iTexts.join(" — ") : null;

    out.push({ nome, descrizione: orNull(descrizione), path, codes, azione: null, infoLink });
  });

  return { servizi: out };
}

