import express from "express";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { CacheStore } from "./cache/store.js";
import { SessionRegistry } from "./server/sessions.js";
import { buildRoutes } from "./server/routes.js";
import {
  requestLogger,
  errorHandler,
  securityHeaders,
  createLoginLimiter,
} from "./server/session-middleware.js";

// Process wiring. The order matters: config (fail loud), then the shared store +
// the in-RAM session registry, then the HTTP layer. The login rate limiter is
// in-memory and intentionally simple — one trusted upstream (LINFO).

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = new CacheStore();
  // Purge a user's cached data the moment their session ends, so RAM never holds
  // personal data past the session that needs it.
  const registry = new SessionRegistry(config.baseUrl, {
    onEvict: (matricola) => store.deletePrefix(`${matricola}:`),
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use(securityHeaders(config));
  app.use(requestLogger);
  app.use("/session/login", createLoginLimiter());
  app.use(buildRoutes({ registry, store, config, version: VERSION }));
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(`delphi-wrapper listening on http://127.0.0.1:${config.port}`);
  });

  const shutdown = (sig: string) => {
    logger.info({ sig }, "shutting down");
    server.close(async () => {
      await registry.closeAll();
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "fatal boot error");
  process.exit(1);
});
