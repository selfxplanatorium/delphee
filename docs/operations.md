# Operations and deployment

This guide describes the current runtime behavior. It does not claim that Delphee is ready for an unrestricted public deployment.

## Configure the process

All configuration is optional. Invalid values stop the process during startup.

| Variable | Default | Accepted value |
| --- | --- | --- |
| `DELPHI_BASE_URL` | `https://delphi.uniroma2.it` | Valid URL |
| `PORT` | `7822` | Positive integer |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, or `fatal` |
| `NODE_ENV` | `development` | String; `production` disables pretty console logs |

When started from the repository, the process loads `.env` if the file exists. Ambient environment variables remain the normal production configuration path.

Do not put student credentials in `.env`. Clients provide them to the login endpoint.

## Run a local process

Install dependencies:

```sh
npm install
```

Start the watched TypeScript process:

```sh
npm run dev
```

For the compiled path, build and start the application:

```sh
npm run build
npm start
```

Verify the server:

```sh
curl -fsS http://localhost:7822/health
```

The expected response contains `"ok":true` and the current application version.

## Check a change

Run the static and automated checks:

```sh
npm run typecheck
npm test
npm run build
```

The test suite uses anonymized Delphi captures under `tests/fixtures`. It checks the parsers, login recovery, session expiry, cache cleanup callbacks, and failure logging.

Use the demo account for a browser smoke test:

| Field | Value |
| --- | --- |
| Student ID | `0000000` |
| Password | `demo` |

The demo does not validate the live Delphi login or current portal markup.

## Capture live pages for parser work

`npm run capture` contacts Delphi and writes raw responses under `captures/`. Use it only with accounts whose owner has authorized the capture.

Set `CAPTURE_ACCOUNTS` to a JSON array before running it:

```sh
CAPTURE_ACCOUNTS='[{"tag":"my-account","matricola":"STUDENT_ID","password":"PASSWORD"}]' npm run capture
```

The `captures/` directory is ignored by Git. Raw portal pages contain personal data. Do not commit, share, or retain them longer than needed. Anonymize selected fixtures before adding them to `tests/fixtures`.

## Docker status

The supplied image uses a Node 22 Alpine build stage, runs as an unprivileged user, and starts through `tini`. The Compose file binds port `7821` to `127.0.0.1`, reads `.env`, defines a health check, and uses Docker's rotating `json-file` logs.

The image build does not require a checked-in lockfile. The `Dockerfile` copies
`package.json` and runs `npm install`, which regenerates `package-lock.json`
inside the build image. Lockfiles are intentionally ignored in this repository.

To build and run the Compose service from a clean clone:

```sh
cp .env.example .env
docker compose up -d --build
curl -fsS http://127.0.0.1:7821/health
```

The clean Docker image build has been verified. Compose still requires a local
`.env` file with the runtime configuration shown in `.env.example`.

## Run behind a trusted edge

Delphee listens with plain HTTP on every network interface, not only on `localhost`. Anyone who can reach the host on the port can reach the login endpoint. The Compose file avoids this by binding to `127.0.0.1`. For `npm run dev` and `npm start`, restrict the port with a firewall or put the process behind an edge as described below.

For access beyond the local machine, place it behind a service that provides TLS and access controls.

At minimum:

- Terminate HTTPS before traffic reaches Delphee.
- Restrict direct access to the Delphee port.
- Protect bearer tokens from browser history, analytics, and logs.
- Apply a login policy appropriate for the expected number of users.
- Set log access and retention as if upstream excerpts could contain personal data.
- Monitor `401`, `429`, and `5xx` responses without recording credentials or tokens.

The built-in login limiter is global to one process. Five attempts by any combination of users within one minute can block later attempts. It is not a replacement for an edge rate limiter.

## Plan process topology

Sessions and cached responses exist only in process memory. A request sent to another replica cannot use the first replica's token.

Use one process for the current implementation. If you add replicas, provide sticky routing or a shared session design first. Restarting the process signs out every user and clears all cached data.

The server handles `SIGINT` and `SIGTERM`. It stops accepting connections, closes user HTTP clients, clears the cache, and exits. A forced exit follows after 5 seconds if graceful shutdown does not complete.

## Manage logs

Development mode uses `pino-pretty`. Production mode writes structured JSON to standard output.

Known credential fields are redacted. The failure logger also records the route, status, and a short upstream error description. Since upstream text can be unpredictable, avoid broad log access and use a short retention period.

The Compose file rotates logs after 10 MB and keeps three files. Those files live in Docker-managed storage, so the deployment is not literally free of data at rest.

## Monitor health

Use `GET /health` for a process-level liveness check. It confirms that Express is serving requests, but it does not contact Delphi or GOMP.

A successful health response does not prove that login, parsing, PDFs, or study-plan access currently work. Verify those paths with an authorized live account when a release depends on them.
