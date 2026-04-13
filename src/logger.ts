/**
 * Structured stderr JSON logger. stdout is reserved for MCP protocol.
 * Levels: error (always), warn (always), debug (gated).
 */

import { DEBUG } from "./config.js";

type Level = "error" | "warn" | "debug";

interface LogFields {
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields?: LogFields): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  try {
    process.stderr.write(JSON.stringify(record) + "\n");
  } catch {
    // Fallback for circular refs etc.
    process.stderr.write(`${level} ${msg}\n`);
  }
}

export const log = {
  error(msg: string, fields?: LogFields): void {
    emit("error", msg, fields);
  },
  warn(msg: string, fields?: LogFields): void {
    emit("warn", msg, fields);
  },
  debug(msg: string, fields?: LogFields): void {
    if (DEBUG) emit("debug", msg, fields);
  },
};
