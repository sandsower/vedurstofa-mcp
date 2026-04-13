import type { ZodTypeAny, infer as ZodInfer } from "zod";

import type { Station } from "../stations.js";

/**
 * Tool descriptor used by the registry. Each tool supplies a zod schema
 * for its input and a handler that receives validated input + server context.
 * Schema is generic so defaults/transforms infer correctly.
 */
export interface ToolContext {
  /** Preloaded station catalog. */
  stations: Station[];
}

export interface ToolDescriptor<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  /** JSON Schema for MCP `tools/list`. Keep aligned with `schema`. */
  inputSchema: Record<string, unknown>;
  /** Zod parser for incoming arguments. */
  schema: S;
  handler(input: ZodInfer<S>, ctx: ToolContext): Promise<string>;
}
