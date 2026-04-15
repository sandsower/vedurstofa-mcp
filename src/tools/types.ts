import type { ZodTypeAny, infer as ZodInfer } from "zod";

/**
 * Tool descriptor used by the registry. Each tool supplies a zod schema
 * for its input and a handler that receives validated input + server context.
 * Schema is generic so defaults/transforms infer correctly.
 */
// Reserved for future per-request state (auth, tracing, etc.). The station
// catalog used to live here but was moved to on-demand loading so the MCP
// initialize handshake isn't blocked by a cold upstream fetch.
export type ToolContext = Record<string, never>;

export interface ToolDescriptor<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  /** JSON Schema for MCP `tools/list`. Keep aligned with `schema`. */
  inputSchema: Record<string, unknown>;
  /** Zod parser for incoming arguments. */
  schema: S;
  handler(input: ZodInfer<S>, ctx: ToolContext): Promise<string>;
}
