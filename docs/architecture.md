# Architecture

Delphee sits between a client and the Delphi student portal. It keeps one upstream session for each logged-in student and converts selected HTML pages into typed JSON responses.

## Request flow

1. A client sends a student ID and password to `POST /session/login`.
2. Delphee creates a dedicated HTTP client and cookie jar for that student.
3. A successful login creates a random 32-byte bearer token.
4. The client sends that token with later requests.
5. Delphee loads a valid cached value or fetches the required Delphi page.
6. A parser converts the HTML into the response type defined in `src/types.ts`.
7. Delphee returns JSON and stores eligible data in memory.

The browser interface uses the same API. For full portal pages, it uses the authenticated `/totem/*` pass-through route.

## Main components

| Component | Responsibility |
| --- | --- |
| `src/index.ts` | Loads configuration, creates shared services, and starts Express |
| `src/server/routes.ts` | Defines the public HTTP interface |
| `src/server/sessions.ts` | Creates, finds, expires, and closes user sessions |
| `src/client/session.ts` | Handles one student's Delphi login and re-login |
| `src/client/fetcher.ts` | Sends upstream requests, follows redirects, and manages cookies |
| `src/server/api.ts` | Connects routes, cache policy, upstream pages, and parsers |
| `src/client/endpoints/*.ts` | Parses individual Delphi pages, including the study-plan PDF (`piano-pdf.ts`) |
| `src/client/gomp.ts` | Opens and drives one GOMP session through Delphi's single sign-on |
| `src/insights/carriera.ts` | Career statistics, graduation forecast, target grade, attempts, timeline, checklist |
| `src/insights/sessione.ts` | Plans one exam sitting per missing exam |
| `src/server/ics.ts` | Writes iCalendar files for bookings and planned sittings |
| `src/cache/store.ts` | Stores JSON strings in process memory |
| `src/server/static/*` | Implements the browser interface |

## Sessions

Each session has its own `Fetcher` and cookie jar. Users do not share Delphi cookies.

The `Session` object keeps the submitted credentials in memory so it can sign in again when Delphi returns an expired session. It never writes them through a project storage layer. The session registry removes an idle session after it has passed the 30-minute idle threshold. Its cleanup task runs every 5 minutes, so actual removal can happen later than the threshold.

Logout removes the registry entry, clears its cookies, closes the HTTP client, and deletes cache entries for that student. A process restart removes all sessions and cache entries.

The token is generated with `randomBytes(32)` and encoded with base64url. Delphee does not provide token refresh, account roles, or a second authentication layer.

The session also holds at most one GOMP session, opened the first time a GOMP page or the plan PDF is requested. It is closed on logout and idle eviction, like the Delphi session.

## Cache behavior

Cache keys start with the student's ID. This prevents one account from receiving another account's cached response.

| Data | Lifetime |
| --- | --- |
| Academic record | No time expiry |
| Student profile | 24 hours |
| Study plan, including the exams read from its PDF | 24 hours |
| Student services | 24 hours |
| Certificates | 1 hour |
| ISEE authorization | 1 hour |
| Courses open for enrolment | 1 hour |
| Course syllabus | 24 hours |
| Fees | 1 hour |
| Exam sessions | 5 minutes |
| Open records | 5 minutes |
| Pending exams | 5 minutes |
| Exam bookings | 5 minutes |

"No time expiry" applies only while the session and process remain alive. Login, logout, idle eviction, and process shutdown remove the student's cached entries.

Expired entries remain in memory until replacement or session removal. If a live refresh fails, Delphee can return the expired value with `X-Cache-Stale: true`. It does not use stale data when Delphi reports invalid credentials.

## Upstream access

Normal Delphi requests have a minimum 1.2-second dispatch gap for each user session. Retryable network failures receive up to three attempts, with delays of 1 second and 4 seconds between attempts.

The login handshake also receives up to three attempts. Its retry delays are 500 milliseconds and 2 seconds. An explicit invalid-credentials response stops retries.

The fetcher follows up to five redirects and carries the session cookies through each hop. It decodes Delphi HTML as Latin-1 because the portal does not consistently serve UTF-8.

If an authenticated data request returns the login page, `Session` signs in again and repeats that operation once.

Some Delphi pages redirect to a dashboard that breaks the session once it is followed. `/anagrafica` therefore reads that redirect without following it, and parses the dashboard only when Delphi serves it directly. Following the redirect made every later page answer `500` until the next login.

The `/totem/*` browser proxy behaves differently. It sends one request without the normal delay or retry path, keeps redirects visible to the browser, and does not rewrite HTML.

## GOMP study plans

The study-plan route follows Delphi's single sign-on redirect to GOMP and reads the plan list. The browser can also use GOMP itself through the GOMP mirror described in the [API reference](api.md#gomp-mirror). The mirror keeps one GOMP session on the user's `Session` and closes it on logout. `/piano/pdf` opens a new GOMP session and downloads one plan, which GOMP serves only as a PDF. Delphee does not automate the GOMP plan editor. GOMP refuses graduated students, so their plan list is empty. If this bridge fails, `/piano` returns an empty result with a URL that the browser can open.

## Study-plan PDF

GOMP serves a study plan only as a PDF, so `src/client/endpoints/piano-pdf.ts` reads the exam list from it with `pdfjs-dist`. Reading happens in two steps: `extractItems` returns the positioned text items of each page, and `parse` turns those items into exams. The parser uses the layout of the plans seen so far. Titles and body text are 9–10 point, the header and footer are larger or smaller, and the columns sit at fixed horizontal positions. A change to GOMP's PDF layout can make `parse` return fewer exams, or none. In that case `/piano` still returns the plan list and an empty `esami`.

The test fixture `tests/fixtures/pianoPdf.items.json` holds the text items of a real plan with the student's name and identifiers removed from the header and footer.

## Analysis modules

`src/insights` holds pure functions with no I/O. `Api` collects the inputs from the cached sources, and the modules compute the results:

- `carriera.ts` computes the weighted average the way Delphi does (passed exams graded in thirtieths, partial results excluded, "30 e lode" counted as 30), and checks it against both test accounts. The academic year starts on 1 November. Exams are joined across sources by their code. Bookings are linked to outcomes through the record number.
- The graduation forecast uses the plan's highest year as the normal course length. Without a plan, it uses the course type: 3 years for a bachelor's degree, 2 for a master's, 5 for a single-cycle degree. The pace is the CFU earned in the last 365 days, or the average since enrolment when there is none. Projections are estimates from that pace, not Delphi's own figures.
- `sessione.ts` is a greedy planner. Booked exams are fixed first, then exams with the fewest sittings, then the heaviest. A sitting is kept at least 5 days from every other chosen sitting for exams of 12 CFU or more, 4 days for 9 CFU, and 3 days otherwise. The larger of the two exams' values applies. If no sitting fits, the planner takes the one farthest from the others and marks it `ravvicinato`.
- `src/server/ics.ts` writes RFC 5545 calendars. Times are in Europe/Rome, with an explicit `VTIMEZONE`, and lines are folded at 75 octets.

## Data and logs

The application does not use a database or write sessions and cache entries to project files. This reduces stored data but does not remove the need to protect the process, memory, network, and logs.

Pino redacts known fields such as `password`, `matricola`, cookies, and authorization headers. Upstream failures can include a short excerpt from a Delphi response inside the log message. Because that content is not predictable, operators should treat logs as potentially sensitive.

Container and service managers can persist standard output even when the application itself does not open a log file. The supplied Compose configuration uses Docker's `json-file` logging driver.

## Known limits

- Parsers depend on Delphi's current HTML structure.
- Delphi and GOMP behavior differs by account type and academic state.
- Some best-effort routes return an empty result when the upstream flow fails.
- Sessions and cache entries are local to one process. Multiple replicas do not share them.
- The process-wide login limiter allows five attempts per minute across all clients.
- The server does not terminate TLS.
- The demo blocks upstream requests and is not a complete substitute for live verification.
- The course list reads only the first results page of Delphi.
- Booking, enrolment, and degree-application actions are not implemented. The reads around them are.
- The planner depends on the calendars Delphi has published. Before a session opens it proposes nothing.
- The graduation forecast and the target-grade figures are estimates. They do not replace the rules of the degree programme.

Use the [API reference](api.md) for the public interface and [operations and deployment](operations.md) for runtime guidance.
