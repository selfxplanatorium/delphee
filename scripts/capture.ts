import { writeFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { Fetcher } from "../src/client/fetcher.js";
import { Session } from "../src/client/session.js";

// Observability baseline. Logs into both real accounts and dumps the raw HTML
// of every known route, so the parsers can be written and tested against
// ground truth rather than assumptions in the documentation. Run with
// `npm run capture`. Output lands in captures/<account>/<name>.html plus a
// captures/summary.json with status + byte size + content-type per route.

const config = loadConfig();

// Accounts come from CAPTURE_ACCOUNTS (JSON array of {tag,matricola,password}).
// The wrapper no longer keeps any account in config, so this is required.
interface Account {
  tag: string;
  matricola: string;
  password: string;
}

function loadAccounts(): Account[] {
  const raw = process.env.CAPTURE_ACCOUNTS;
  if (!raw) {
    throw new Error(
      'CAPTURE_ACCOUNTS is required, e.g. CAPTURE_ACCOUNTS=\'[{"tag":"me","matricola":"...","password":"..."}]\'',
    );
  }
  return JSON.parse(raw) as Account[];
}

const ACCOUNTS = loadAccounts();

const ROUTES: Array<{ name: string; path: string }> = [
  { name: "dashboard-laureati", path: "/totem/jsp/Iscrizioni/sStudentiLaureatiLogin.jsp?language=IT" },
  { name: "dashboard-regolari", path: "/totem/jsp/Iscrizioni/sStudentiRegolariLogin.jsp?language=IT" },
  { name: "datiStudente", path: "/totem/jsp/Iscrizioni/datiStudente.jsp" },
  { name: "esamiVerbalizzati", path: "/totem/jsp/Iscrizioni/esamiVerbalizzati.jsp" },
  { name: "situazioneRateNew", path: "/totem/jsp/Iscrizioni/situazioneRateNew.jsp" },
  { name: "sStudentiAttivaServizi", path: "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp" },
  { name: "preIndexCertificati", path: "/totem/jsp/studenti/stampaCertificati/preIndexCertificati.jsp" },
  { name: "pianoDiStudi", path: "/totem/jsp/studenti/pianoDiStudi/index.jsp" },
  { name: "esamiPendenti", path: "/totem/jsp/studenti/esami/esamiPendenti.jsp" },
  { name: "verbaliNonChiusi", path: "/totem/jsp/studenti/esami/verbaliNonChiusi.jsp" },
  { name: "menuPrenotazioni", path: "/totem/jsp/prenotazioni/menuPrenotazioni.jsp" },
  { name: "calendarioEsami", path: "/totem/jsp/prenotazioni/calendarioEsami.jsp" },

  // Servizi activation sub-pages — the `?Entra=` flows behind each service link,
  // so we can integrate them natively in the wrapper instead of only proxying.
  // (An account that lacks a given service redirects back to the list; the
  // captured status/finalPath shows which ones actually resolved.)
  { name: "serv-office365-menu", path: "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp?Entra=../emailMicrosoft/menuEmail.jsp" },
  { name: "serv-office365-resetpw", path: "/totem/jsp/emailMicrosoft/menuEmail.jsp?Entra=resetPassword.jsp" },
  { name: "serv-office365-stato", path: "/totem/jsp/emailMicrosoft/menuEmail.jsp?Entra=attivaAccount.jsp&Lista=yes" },
  { name: "serv-nationalinstruments", path: "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp?Entra=../Iscrizioni/sStudentiAttivaNationalInstruments.jsp" },
  { name: "serv-mycampus", path: "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp?Entra=../myCampus/richiestaAttivazione.jsp" },
];

interface Row {
  account: string;
  name: string;
  status: number;
  bytes: number;
  contentType: string;
  finalPath: string;
}

async function main(): Promise<void> {
  const fetcher = Fetcher.create(config.baseUrl, 2000);
  const session = new Session(fetcher);
  const summary: Row[] = [];

  for (const acct of ACCOUNTS) {
    const dir = `captures/${acct.tag}`;
    mkdirSync(dir, { recursive: true });
    process.stdout.write(`\n=== ${acct.tag} (${acct.matricola}) ===\n`);

    session.logout();
    try {
      await session.login({ matricola: acct.matricola, password: acct.password });
      process.stdout.write(`login: OK\n`);
    } catch (err) {
      process.stdout.write(`login FAILED: ${(err as Error).message}\n`);
      continue;
    }

    for (const route of ROUTES) {
      try {
        const res = await fetcher.get(route.path);
        writeFileSync(`${dir}/${route.name}.html`, res.body, "latin1");
        const row: Row = {
          account: acct.tag,
          name: route.name,
          status: res.status,
          bytes: Buffer.byteLength(res.body, "latin1"),
          contentType: res.contentType,
          finalPath: res.finalPath,
        };
        summary.push(row);
        process.stdout.write(
          `  ${route.name.padEnd(24)} ${row.status}  ${String(row.bytes).padStart(7)}b  ${row.finalPath}\n`,
        );
      } catch (err) {
        summary.push({
          account: acct.tag,
          name: route.name,
          status: -1,
          bytes: 0,
          contentType: "",
          finalPath: (err as Error).message,
        });
        process.stdout.write(`  ${route.name.padEnd(24)} ERR  ${(err as Error).message}\n`);
      }
    }
  }

  writeFileSync("captures/summary.json", JSON.stringify(summary, null, 2));
  await fetcher.close();
  process.stdout.write("\ncaptures/summary.json written\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
