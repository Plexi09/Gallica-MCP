import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createGallicaServer } from "./server.js";

const app = express();
app.use(express.json());

async function handleMcp(
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const server = createGallicaServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err: unknown) {
    console.error(err instanceof Error ? err.message : err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

app.post("/mcp", (req, res) => {
  void handleMcp(req, res);
});

app.get("/mcp", (req, res) => {
  void handleMcp(req, res);
});

const port = Number(process.env["PORT"] ?? 8000);
app.listen(port, () => {
  console.error(`Gallica-mcp HTTP listening on port ${port}`);
});
