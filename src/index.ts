/**
 * Entry point. tsup injects the `#!/usr/bin/env node` shebang at build time.
 */

import { startServer } from "./server.js";
import { log } from "./logger.js";

startServer().catch((err) => {
  log.error("fatal startup error", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
