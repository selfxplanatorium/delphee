import pino from "pino";
import { loadConfig } from "./config.js";

// One logger instance for the whole process. Secrets (password, matricola,
// cookies) are redacted at the pino level so they can never leak through any
// log call, no matter where it lives.

const config = loadConfig();

const redact = [
  "password",
  "matricola",
  "*.password",
  "*.matricola",
  "req.headers.cookie",
  "req.headers.authorization",
  "headers.cookie",
  "headers.authorization",
  "cookies",
  "cookie",
  "session.cookies",
];

export const logger = pino({
  level: config.logLevel,
  redact: { paths: redact, censor: "[redacted]" },
  ...(config.nodeEnv !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss" },
        },
      }
    : {}),
});
