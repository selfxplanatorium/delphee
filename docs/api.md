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
| `GET` | `/appelli` | `AppelloCalendario[]` or `Appello[]` |
| `GET` | `/piano` | `Piano` |
| `GET` | `/tasse` | `SituazioneTasse` |
| `GET` | `/servizi` | `ServiziResponse` |
| `GET` | `/servizi/genera` | `{ "code": string | null }` |
| `GET` | `/certificati` | `CertificatiResponse` |
| `GET` | `/verbali` | `VerbaliResponse` |
| `GET` | `/esami-pendenti` | `EsamiPendentiResponse` |
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
| `401` | `no_session` | Token is missing, unknown, or expired |
| `401` | `invalid_credentials` | Delphi rejected the credentials |
| `429` | `rate_limited` | The process-wide login limit was reached |
| `503` | `delphi_unavailable` | Delphi or a dependent upstream request failed |
| `500` | `internal_error` | An unexpected server error reached the final error handler |
