import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGallicaTools } from "./tools.js";

export function createGallicaServer(): McpServer {
  const server = new McpServer({
    name: "Gallica-mcp",
    version: "0.1.0",
  });
  registerGallicaTools(server);
  return server;
}
