# API reference

Delphee serves JSON, PDF files, and a small browser interface. The default local base URL is `http://localhost:7822`.

The TypeScript interfaces in [`src/types.ts`](../src/types.ts) define the JSON response fields.

## Authentication

Call `POST /session/login` with a student ID and password. A successful response returns an opaque token and sets an HTTP-only `dw_token` cookie.

Send the token on JSON requests:

```http
Authorization: Bearer TOKEN
```

The browser interface uses the same token. The `dw_token` cookie also allows top-level navigation through the `/totem/*` proxy.

Do not expose the token in URLs or logs. Anyone who has it can use the associated session until logout, eviction, or process shutdown.

## Public routes

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/` | Browser interface |
| `GET` | `/health` | `{ "ok": true, "version": "0.1.0" }` |
| `GET` | `/config` | `{ "version": "0.1.0" }` |
| `GET` | `/privacy` | Privacy information page |
| `GET` | `/progetto` | Project information page |
| `GET` | `/static/*` | Browser interface assets |

## Session routes

### Create a session

`POST /session/login` accepts this JSON body:

```json
{
  "matricola": "STUDENT_ID",
  "password": "PASSWORD"
}
```

Both fields are required. A successful response has this form:

```json
{
  "token": "TOKEN",
  "state": "logged_in",
  "matricola": "STUDENT_ID",
  "since": 1710000000000,
  "lastError": null
}
```

The process accepts at most five login requests in a rolling 60-second window. This limit is shared by all clients of one Delphee process. A rejected request returns `429` and a `Retry-After` header.

### Read session status

`GET /session/status` reads the bearer token and returns a `SessionInfo` object. A missing or unknown token returns the logged-out state with status `200`.

### End a session

`POST /session/logout` reads the bearer token, removes the session if it exists, clears the `dw_token` cookie, and returns the logged-out state. Repeating the request is safe.

## Data routes

These routes require a valid bearer token or session cookie.

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/anagrafica` | `Anagrafica` |
| `GET` | `/carriera` | `CarrieraResponse` |
| `GET` | `/carriera/esami` | Filtered `EsamiResponse` |
| `GET` | `/carriera/insights` | `CarrieraInsights` |
| `GET` | `/carriera/sessione` | `PianoSessione` |
| `GET` | `/carriera/sessione.ics` | Planned exam sessions as iCalendar |
| `GET` | `/appelli` | `AppelloCalendario[]` or `Appello[]` |
| `GET` | `/piano` | `Piano` |
| `GET` | `/piano/pdf` | Study plan PDF from GOMP |
| `GET` | `/tasse` | `SituazioneTasse` |
| `GET` | `/servizi` | `ServiziResponse` |
| `GET` | `/servizi/genera` | `{ "code": string | null }` |
| `GET` | `/certificati` | `CertificatiResponse` |
| `GET` | `/verbali` | `VerbaliResponse` |
| `GET` | `/esami-pendenti` | `EsamiPendentiResponse` |
| `GET` | `/prenotazioni` | `PrenotazioniResponse` |
| `GET` | `/prenotazioni/dettaglio` | `PrenotazioneDettaglio` |
| `GET` | `/prenotazioni/dossier` | Booking details with past attempts and syllabus |
| `GET` | `/prenotazioni/ricevuta` | Booking receipt PDF |
| `GET` | `/prenotazioni/calendario.ics` | Upcoming bookings as iCalendar |
| `GET` | `/tasse/isee` | `IseeResponse` |
| `GET` | `/corsi` | `CorsiResponse` |
| `GET` | `/appelli/info` | `InfoInsegnamento` |
| `GET` | `/iscrizione/domanda` | Enrolment application PDF |
| `GET` | `/tasse/ricevuta` | Receipt PDF |
| `GET` | `/certificati/stampa` | Certificate PDF |

### Filter exams

`GET /carriera/esami` accepts these optional query parameters:

| Parameter | Value |
| --- | --- |
| `nome` | Partial course-name match |
| `ssd` | Academic discipline code |
| `aa` | Academic year, such as `2025/2026` |
| `stato` | One or more comma-separated values: `superato`, `in_corso`, `non_superato`, `idoneo` |
| `partial` | `true`, `1`, `false`, or `0` |
| `cfuMin` | Minimum credits as an integer |
| `cfuMax` | Maximum credits as an integer |

Invalid filter values are ignored rather than rejected.

### Search exam sessions

`GET /appelli` has two modes.

Without `insegnamento`, it searches the exam calendar and returns `AppelloCalendario[]`. It accepts these optional parameters:

| Parameter | Default | Value |
| --- | --- | --- |
| `anno` | Current academic year | `YYYY/YYYY` |
| `sessione` | `TUTTE` | `TUTTE`, `ESTIVA`, `ESTIVA ANTICIPATA`, `AUTUNNALE`, `INVERNALE`, or `STRAORDINARIA` |
| `iniziale` | `-1` | `-1` for all courses, or `A` through `Z` |
| `datainizio` | Empty | Start date in `DD/MM/YYYY` format |
| `datafine` | Empty | End date in `DD/MM/YYYY` format |

With `insegnamento=COURSE_CODE`, it uses the older single-course lookup and returns `Appello[]`.

The calendar path returns an empty array when Delphi does not provide results or the best-effort lookup fails.

### Generate a service code

`GET /servizi/genera` performs the upstream action that creates a code for services such as MyCampusXApp.

It requires both parameters:

- `ctx`: the service activation page returned by `/servizi`
- `path`: the generation action returned in the service's `azione.path`

Both values must be `/totem/*.jsp` paths. The request changes state in Delphi even though the current HTTP method is `GET`. Call it only after an explicit user action.

### Read exam bookings

`GET /prenotazioni` lists every exam booking, active and past. Each entry carries a `ref` object with `id`, `index`, and `ordine`.

`GET /prenotazioni/dettaglio` and `GET /prenotazioni/ricevuta` require those three `ref` values as query parameters. They return the booking's room, time, and modules, or the booking receipt PDF. Non-numeric values return `400 invalid_prenotazione`.

`GET /prenotazioni/calendario.ics` returns every booking whose exam date is today or later as an iCalendar file. Events with a known start time are in Europe/Rome time and last two hours, because Delphi publishes no end time. Bookings without a time become all-day events.

Booking and cancelling exams are not implemented.

`GET /prenotazioni/dossier` takes the same `ref` values and returns everything about one booking in one response:

- `dettaglio`: the booking details described above
- `tentativi`: earlier attempts at the same exam, or `null`
- `info`: the course syllabus, or `null` when none is found
- `giorni`: days until the exam, or `null` when there is no exam date

The `tentativi` and `info` parts are best-effort. Failures in them leave those fields empty and do not fail the request.

### Download a study plan

`GET /piano/pdf` requires `ps`, the plan id returned in `/piano`'s `piani` entries. Delphee opens a GOMP session for the request and streams the plan PDF. A value that is not a UUID returns `400 invalid_piano`.

`GET /piano` reads the exams of the current plan from that PDF. "Current" is the newest submitted plan, so a plan awaiting approval takes precedence over an older approved one. Each exam in `esami` has `stato` (`superato`, `in_corso`, or `da_fare`, matched to the exam record by code), `ssd`, `taf` (the activity type letter), and `gruppo` (the plan section, such as `Insegnamenti obbligatori` or an elective group). `esamiDa` names the plan the exams came from. If the PDF cannot be read, `esami` is empty and the plan list is still returned.

### Study-plan insights

`GET /carriera/insights` combines the exam record with the study plan, bookings, fees, ISEE authorization and profile. Only the exam record is required. The other sources are best-effort and contribute nothing when they fail. The response has these sections:

| Field | Content |
| --- | --- |
| `progresso` | Credits earned and remaining, from the plan when available |
| `media` | Weighted average and degree base (on 110), grade distribution, and the running average |
| `perAnno` | Credits and exam count per academic year |
| `previsione` | Graduation forecast from the recent pace, with `inCorso` telling whether the forecast falls within the normal course length |
| `obiettivo` | Remaining graded credits, for the target-grade calculation |
| `tentativi` | Attempts per exam, linked to bookings through the record number |
| `timeline` | Dated events of the career, newest last |
| `checklist` | Open items before graduation, with the status of each |
| `gruppiScelta` | Elective groups of the plan |

The academic year starts on 1 November. A booking with no matching grade is reported as `senza_esito`. Delphi does not say whether that was a withdrawal, an absence or a failure.

Calls with `?refresh=1` drop the cached sources this response is built from.

### Session planner

`GET /carriera/sessione` proposes one sitting per exam still missing from the plan, drawn from the calendars of the previous and the current academic year. Heavier exams are spaced further apart. Booked exams keep their date. The response is a `PianoSessione`:

| Field | Content |
| --- | --- |
| `da`, `a` | Planning window: today and about five months ahead |
| `pianificati` | One entry per exam: chosen sitting, alternative dates, booking state, and `ravvicinato` when the exam sits close to another |
| `senzaAppello` | Exams with no sitting in the window |

The query parameter `escludi` takes a comma-separated list of exam codes to leave out of the plan.

`GET /carriera/sessione.ics` returns the same planned sittings as an iCalendar file. Accepts the same `escludi` parameter.

### Read a course syllabus

`GET /appelli/info` requires `idCorIns`, the course id returned by the `/appelli` calendar search. It returns the objectives, prerequisites, teaching and assessment methods, and programme that the teacher published. Each module of the course has its own programme. Fields the teacher left empty are `null`. A non-numeric id returns `400 invalid_insegnamento`.

### List courses open for enrolment

`GET /corsi` lists the courses the student can enrol in under "Frequenza corsi di insegnamento". Delphi asks for a contact email first. Delphee resubmits the address Delphi already has on record, so the account does not change. Only the first results page is read.

Enrolling is not implemented. Each entry's `id` is Delphi's enrolment id, returned for reference only.

### Reprint the enrolment application

`GET /iscrizione/domanda` returns the latest enrolment application ("domanda di iscrizione") as a PDF.

### Read ISEE authorization

`GET /tasse/isee` lists the ISEE-U authorizations per academic year. Accounts without that Delphi page receive an empty list.

### Download a receipt

`GET /tasse/ricevuta` requires `bollettinoId`. It also accepts the optional `rataId` and `aa` values returned by `/tasse`.

The response is sent inline with the filename `ricevuta-BOLLETTINO_ID.pdf`.

### Print a certificate

`GET /certificati/stampa` requires the `path` returned by `/certificati`. Pass the certificate's other parameters, such as `tipo`, in the same query string.

The server accepts only relative `.jsp` paths made of letters, digits, underscores, dots, slashes, and hyphens.

## Portal proxy

`/totem/*` passes a single authenticated request to the matching Delphi path. It supports the HTTP methods handled by Express and forwards raw form bodies up to 8 MB.

The proxy does not cache responses, apply the normal upstream delay, retry failed requests, or rewrite response bodies. It rewrites same-origin redirect locations so navigation remains on the Delphee origin.

This route exists for browser pages that cannot be represented by the JSON API. It is not a general-purpose proxy.

## GOMP mirror

GOMP hosts the study-plan composer. Delphee serves GOMP's pages on its own origin under these paths: `/WorkFlow2011/*`, `/Questionari/*`, `/Scripts/*`, `/CSS/*`, `/images/*`, `/ig_res/*`, `/ScriptResource.axd`, and `/WebResource.axd`. Start at `/WorkFlow2011/Studenti/Composer/ElencoPiani.aspx`.

Authentication works like `/totem/*`. Delphee opens the GOMP session through Delphi's single sign-on on first use, keeps the GOMP cookies on the server, and opens a new GOMP session when GOMP sends a GET to a login page. Response bodies are not rewritten. Redirects to GOMP or Delphi become local paths.

The composer is GOMP's own interface. Delphee has no JSON API for creating or changing plans. Building one needs an account whose plan window is open and that has not yet submitted a plan for the year, so tests have no consequences. Contributions from someone who can offer such an account are welcome.

## Cache status

JSON data routes can return an expired cached value when a live Delphi request fails. In that case the response includes:

```http
X-Cache-Stale: true
```

Clients should show that the data might be out of date. PDF, service-generation, and proxy routes do not use this stale response path.

## Errors

Error responses use a short JSON object:

```json
{
  "error": "ERROR_CODE"
}
```

| Status | Error | Meaning |
| --- | --- | --- |
| `400` | `missing_credentials` | Login body is incomplete |
| `400` | `missing_bollettinoId` | Receipt ID is missing |
| `400` | `missing_path` | Certificate path is missing |
| `400` | `invalid_path` | Certificate or service path is not allowed |
| `400` | `invalid_insegnamento` | Course id is missing or not numeric |
| `400` | `invalid_piano` | Study plan id is missing or not a UUID |
| `400` | `invalid_prenotazione` | Booking reference is missing or not numeric |
| `401` | `no_session` | Token is missing, unknown, or expired |
| `401` | `invalid_credentials` | Delphi rejected the credentials |
| `429` | `rate_limited` | The process-wide login limit was reached |
| `503` | `delphi_unavailable` | Delphi or a dependent upstream request failed |
| `500` | `internal_error` | An unexpected server error reached the final error handler |
