import { z } from "zod";

// Configuration is validated once at boot and memoized. The process must refuse
// to start on malformed config rather than failing later mid-request, so we fail
// loud and early. No user credentials live here: in the multi-tenant model creds
// arrive per-login and are held in RAM (see server/sessions.ts). Nothing is
// persisted to disk, so there is no cache/data path to configure.

const schema = z.object({
  DELPHI_BASE_URL: z.string().url().default("https://delphi.uniroma2.it"),
  PORT: z.coerce.number().int().positive().default(7822),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z.string().default("development"),
});

export interface AppConfig {
  baseUrl: string;
  port: number;
  logLevel: string;
  nodeEnv: string;
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cachedConfig) return cachedConfig;

  // Load a local .env if present (dev). In production the env is real and this
  // is a no-op. Native loader, no dependency.
  if (env === process.env) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // no .env file — rely on the ambient environment
    }
  }

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  const e = parsed.data;
  cachedConfig = {
    baseUrl: e.DELPHI_BASE_URL.replace(/\/+$/, ""),
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    nodeEnv: e.NODE_ENV,
  };
  return cachedConfig;
}

