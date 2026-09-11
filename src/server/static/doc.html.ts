// Standalone content pages (privacy policy, "sul progetto"). Served outside the
// SPA at their own URLs (/privacy, /progetto) so they are readable BEFORE login
// — a privacy policy that only appears after handing over credentials is not
// GDPR-useful. They reuse the SPA's stylesheet (.doc-* classes) and the same
// no-flash theme bootstrap, but carry no app.js and touch no user data.
//
import { GITHUB_URL } from "./index.html.js";

const UPDATED = "26 giugno 2026";

const SUN_PATH = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON_PATH = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';

function svg(inner: string, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function docShell(title: string, content: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${title} · Delphee</title>
  <meta name="description" content="${title} · Delphee" />
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
<body class="doc-body">
  <header class="doc-head">
    <a class="doc-back" href="/">
      ${svg('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>', 18)}
      <span class="doc-brand">Delphee</span>
    </a>
    <button class="btn btn-ghost btn-icon btn-sm theme-toggle" id="doc-theme" title="Cambia tema" aria-label="Cambia tema">
      <span class="icon-sun">${svg(SUN_PATH, 16)}</span><span class="icon-moon">${svg(MOON_PATH, 16)}</span>
    </button>
  </header>
  <main class="doc-main">
    <article class="doc">
      ${content}
    </article>
    <footer class="doc-foot">
      <a href="/">${svg('<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>', 14)} Torna a Delphee</a>
      <a href="${GITHUB_URL}" target="_blank" rel="noopener">GitHub</a>
    </footer>
  </main>
  <script nonce="${nonce}">
    document.getElementById("doc-theme").addEventListener("click", function () {
      var el = document.documentElement;
      var cur = el.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      var next = cur === "dark" ? "light" : "dark";
      el.setAttribute("data-theme", next);
      try { localStorage.setItem("dw-theme", next); } catch (e) {}
    });
  </script>
</body>
</html>`;
}

export function renderPrivacy(nonce: string): string {
  return docShell("Privacy", `
    <h1>Informativa sulla privacy</h1>
    <p class="doc-meta">Ultimo aggiornamento: ${UPDATED}</p>
    <p class="doc-lead">Delphee è costruito attorno a un principio semplice: i tuoi dati restano tuoi.
    Nessun dato personale viene mai scritto su disco. Questa pagina spiega, in modo trasparente,
    cosa succede ai tuoi dati quando usi il servizio.</p>

    <p><strong>Stato attuale del servizio.</strong> L'istanza pubblica di Delphee gestita dallo
    sviluppatore è attualmente <strong>sospesa</strong> a seguito di un reclamo dell'Ateneo
    (Università di Roma "Tor Vergata"). Di conseguenza, al momento <strong>nessun trattamento viene
    effettuato</strong> da parte mia sui dati degli utenti, e le sezioni che seguono descrivono il
    trattamento che si applicherebbe solo qualora l'istanza pubblica tornasse attiva in futuro.</p>

    <h2>1. Titolare del trattamento e ambito di applicazione</h2>
    <p>Questa informativa si applica <strong>solo ed esclusivamente</strong> all'istanza pubblica di
    Delphee ospitata e gestita dallo sviluppatore.</p>
    <p>Se <strong>ospiti Delphee tu stesso</strong> (è un progetto open source), il titolare del
    trattamento sei tu: questa informativa non si applica alla tua istanza, e sei tu a dover
    redigere la tua, se ne ricorrono i presupposti. Il codice è
    <a href="${GITHUB_URL}" target="_blank" rel="noopener">verificabile</a> proprio per rendere
    agevole questa distinzione.</p>
    <p>Delphee è un progetto indipendente e <strong>non è affiliato</strong> all'Università di Roma "Tor
    Vergata" né al
    portale Delphi.</p>

    <h2>2. Quali dati trattiamo</h2>
    <p>Per funzionare, Delphee tratta:</p>
    <ul>
      <li>Le tue <strong>credenziali Delphi</strong> (matricola e password), che inserisci al login.</li>
      <li>I <strong>dati che Delphi restituisce</strong> per il tuo account: anagrafica, codice fiscale,
      contatti, residenza, carriera ed esami, tasse e pagamenti, certificati e servizi.</li>
    </ul>
    <p>Non chiediamo, non raccogliamo e non trattiamo alcun dato che non provenga direttamente dal tuo
    account Delphi.</p>

    <h2>3. Come e dove vengono trattati</h2>
    <ul>
      <li><strong>Solo in memoria (RAM).</strong> Credenziali, sessione e dati restano esclusivamente nella
      memoria del processo per la durata della tua sessione. <strong>Nulla viene mai scritto su disco</strong>:
      non esiste alcun database, file o backup con i tuoi dati.</li>
      <li><strong>Password: massimo 30 minuti.</strong> Il token di sessione di Delphi è instabile e di breve
      durata, e non può essere usato in modo affidabile per rinnovare la sessione: per questo la password viene
      tenuta in RAM, così da poter rifare automaticamente il login quando la sessione cade. Viene eliminata dopo
      30 minuti di inattività, al logout, o al riavvio del servizio.</li>
      <li><strong>Cache legata alla sessione.</strong> I dati eventualmente memorizzati per velocizzare le
      richieste vengono cancellati al logout o alla scadenza della sessione.</li>
      <li><strong>Un riavvio azzera tutto.</strong> Poiché niente è persistito, riavviare il servizio elimina
      ogni dato; per continuare farai semplicemente di nuovo il login.</li>
    </ul>

    <h2>4. Base giuridica</h2>
    <p>Il trattamento si fonda sul tuo <strong>consenso esplicito</strong> e sulla necessità di eseguire il
    servizio che richiedi: accedere ai <strong>tuoi</strong> dati sul portale Delphi per tuo conto. Inserendo
    le credenziali e premendo "Accedi" autorizzi Delphee a effettuare il login a Delphi al posto tuo.</p>

    <h2>5. A chi vengono comunicati</h2>
    <p>I tuoi dati vengono trasmessi a un solo destinatario: <strong>il portale Delphi
    (<code>delphi.uniroma2.it</code>)</strong>, per autenticarti e leggere i tuoi dati. Non vendiamo,
    cediamo o condividiamo i tuoi dati con terze parti. Non c'è profilazione, non c'è pubblicità, non c'è
    tracciamento analitico.</p>

    <h2>6. Cookie</h2>
    <p>Delphee usa un solo cookie <strong>tecnico</strong>, <code>dw_token</code>, strettamente necessario a
    mantenere la sessione (è <code>httpOnly</code> e non è leggibile da JavaScript). La preferenza di tema
    chiaro/scuro è salvata in <code>localStorage</code> sul tuo dispositivo. Non vengono usati cookie di
    profilazione o di terze parti.</p>

    <h2>7. Conservazione</h2>
    <p>Nessuna conservazione su disco. I dati vivono solo per la durata della sessione e vengono eliminati al
    logout, dopo 30 minuti di inattività, o al riavvio del servizio.</p>

    <h2>8. I tuoi diritti</h2>
    <p>Ai sensi degli artt. 15–22 del GDPR hai diritto di accesso, rettifica, cancellazione, limitazione,
    opposizione e portabilità. Dato che Delphee non conserva nulla, puoi esercitare la cancellazione in
    qualsiasi momento semplicemente facendo <strong>logout</strong> (o chiudendo la sessione): da quel momento
    nessun tuo dato resta nel sistema. I dati permanenti restano gestiti dall'Università tramite Delphi, verso
    cui puoi rivolgerti come titolare di quel trattamento.</p>

    <h2>9. Sicurezza</h2>
    <ul>
      <li>Connessioni cifrate (HTTPS) verso il servizio e verso Delphi.</li>
      <li>La password non viene mai registrata nei log né scritta su disco.</li>
      <li>I log del servizio redigono automaticamente password, matricola, cookie e header di autorizzazione.</li>
      <li>Codice <a href="${GITHUB_URL}" target="_blank" rel="noopener">open source</a>: il trattamento è
      verificabile da chiunque.</li>
      <li>Se non vuoi affidarti a un'istanza gestita da altri, puoi <strong>ospitare Delphee tu stesso</strong>:
      essendo open source, eseguendolo sul tuo dispositivo i tuoi dati non passano mai per server di terzi e
      ogni rischio di fiducia viene azzerato.</li>
    </ul>

    <h2>10. Modifiche</h2>
    <p>Questa informativa può essere aggiornata. Le modifiche rilevanti saranno indicate aggiornando la data in
    cima alla pagina.</p>
  `, nonce);
}

export function renderProgetto(nonce: string): string {
  return docShell("Sul progetto", `
    <h1>Sul progetto</h1>
    <p class="doc-lead">Delphee nasce da una frustrazione condivisa da migliaia di studenti: il portale Delphi
    è lento, ostico e mostrato com'era vent'anni fa. Questo progetto è il tentativo di restituire quei dati in
    una forma pulita, veloce e rispettosa.</p>

    <h2>Perché esiste</h2>
    <p>Sono un ex studente dell'Università di Roma "Tor Vergata". Delphi custodisce la carriera di ognuno di noi
    (esami, tasse, certificati) dietro un'interfaccia datata e poco accessibile. Delphee non sostituisce
    Delphi: lo legge per tuo conto e ti mostra gli stessi dati in modo leggibile, su qualsiasi schermo.</p>
    <p>C'è anche una speranza più grande: se abbastanza studenti useranno strumenti come questo, l'Università
    potrebbe finalmente sentirsi spinta a rinnovare un sistema che ne ha un disperato bisogno.</p>

    <h2>I valori</h2>
    <ul>
      <li><strong>Privacy by design.</strong> Nessun dato personale tocca mai il disco. Tutto vive in memoria,
      per il tempo della sessione, e poi sparisce. Non c'è un database da proteggere perché non c'è un database.
      Vedi la <a href="/privacy">informativa sulla privacy</a>.</li>
      <li><strong>Trasparenza.</strong> Il codice è <a href="${GITHUB_URL}" target="_blank" rel="noopener">open
      source</a>. Chiunque può verificare esattamente cosa succede alle proprie credenziali e ai propri dati.</li>
      <li><strong>Nessun lucro.</strong> Niente pubblicità, niente tracciamento, niente rivendita di dati.
      Delphee non esiste per monetizzarti.</li>
      <li><strong>Semplicità.</strong> Niente bloat, niente dipendenze inutili. Software piccolo, comprensibile
      e onesto.</li>
    </ul>

    <h2>Cosa Delphee non è</h2>
    <ul>
      <li><strong>Non è ufficiale.</strong> È un esperimento personale, non affiliato all'Università né a Delphi.</li>
      <li><strong>Non risolve i problemi di Delphi.</strong> Il portale ha seri limiti, anche di sicurezza, che
      Delphee non può correggere: si limita a leggerlo meglio.</li>
      <li><strong>Non è garantito.</strong> Se Delphi cambia il suo funzionamento, alcune parti potrebbero
      smettere di funzionare finché non vengono aggiornate.</li>
    </ul>

    <h2>Una nota onesta</h2>
    <p>Usare Delphee significa affidargli le tue credenziali per la durata di una sessione. Ho progettato il
    sistema per ridurre questo rischio al minimo possibile, con niente persistenza, una finestra di esposizione
    breve e codice aperto, ma la fiducia va sempre data con consapevolezza. Leggi il codice, leggi la
    <a href="/privacy">privacy</a>, e decidi tu.</p>

    <p>E se non vuoi affidarti a un'istanza gestita da qualcun altro, non devi: essendo
    <a href="${GITHUB_URL}" target="_blank" rel="noopener">open source</a>, puoi <strong>ospitare Delphee tu
    stesso</strong> sul tuo computer. In quel caso le tue credenziali non lasciano mai la tua macchina e ogni
    rischio di fiducia verso terzi viene azzerato.</p>

    <p><a href="${GITHUB_URL}" target="_blank" rel="noopener">Dai un'occhiata al codice su GitHub →</a></p>
  `, nonce);
}
