/**
 * MCP server bootstrap. Wires the stdio transport, preloads the station
 * catalog, and routes tools/list + tools/call to the registry.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { PACKAGE_VERSION } from "./config.js";
import { log } from "./logger.js";
import { loadStations } from "./stations.js";
import { tools } from "./tools/registry.js";
import type { ToolContext } from "./tools/types.js";
import { ValidationError } from "./errors.js";

export async function startServer(): Promise<void> {
  // Preload station catalog before accepting requests so name resolution
  // works on the very first tool call.
  const stations = await loadStations();
  const ctx: ToolContext = { stations };

  const server = new Server(
    {
      name: "vedurstofa-mcp",
      version: PACKAGE_VERSION,
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Unknown tool: ${name}. Call tools/list to see available tools.` },
        ],
      };
    }

    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      return {
        isError: true,
        content: [
          { type: "text", text: `Invalid arguments for ${name}: ${issues}` },
        ],
      };
    }

    try {
      const text = await tool.handler(parsed.data, ctx);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tool handler failed", { tool: name, error: message });
      return {
        isError: true,
        content: [
          { type: "text", text: errorToClaudeMessage(err) },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.debug("vedurstofa-mcp ready", {
    version: PACKAGE_VERSION,
    stationCount: stations.length,
    tools: tools.map((t) => t.name),
  });
}

function errorToClaudeMessage(err: unknown): string {
  if (err instanceof ValidationError) return err.message;
  if (err instanceof Error) return err.message;
  return `Unexpected error: ${String(err)}`;
}
