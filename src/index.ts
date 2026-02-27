import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import cors from "cors";
import express, { type Request, type Response } from "express";

const PORT = Number(process.env.PORT) || 3000;
/** Path único para MCP: GET = SSE, POST = mensagens (n8n HTTP Streamable) */
const MCP_PATH = "/mcp";

// Mapa de sessão -> transport (para rotear POST com sessionId)
const transportsBySession = new Map<string, SSEServerTransport>();

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "mcp-base-conhecimento",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.tool(
    "consultar_base_conhecimento",
    "Lê o arquivo regras.md na raiz do projeto e retorna o conteúdo em texto.",
    {},
    async (): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const baseDir = process.cwd();
      const filePath = join(baseDir, "regras.md");

      try {
        const content = await readFile(filePath, "utf-8");
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Erro ao ler regras.md: ${message}. Verifique se o arquivo existe em ${filePath}.`,
            },
          ],
        };
      }
    }
  );

  return server;
}

const app = express();

app.use(cors({ origin: "*", exposedHeaders: ["Content-Type", "Cache-Control", "Connection"] }));
app.use(express.json({ limit: "4mb" }));

// GET: estabelece o stream SSE (n8n HTTP Streamable)
app.get(MCP_PATH, async (req: Request, res: Response) => {
  const transport = new SSEServerTransport(MCP_PATH, res);
  const server = createServer();

  await server.connect(transport);
  await transport.start();

  const sessionId = transport.sessionId;
  transportsBySession.set(sessionId, transport);

  transport.onclose = () => {
    transportsBySession.delete(sessionId);
  };
});

// POST: recebe mensagens do cliente (sessionId na query ou header)
app.post(MCP_PATH, async (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || (req.headers["mcp-session-id"] as string);

  if (!sessionId) {
    res.status(400).send("Missing sessionId (query or header mcp-session-id)");
    return;
  }

  const transport = transportsBySession.get(sessionId);
  if (!transport) {
    res.status(404).send("Unknown session. Connect via GET /mcp first.");
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "mcp-base-conhecimento" });
});

app.listen(PORT, () => {
  console.log(`MCP Server (SSE) listening on port ${PORT}`);
  console.log(`  GET  ${MCP_PATH} - SSE stream (n8n HTTP Streamable)`);
  console.log(`  POST ${MCP_PATH} - mensagens (sessionId na query)`);
  console.log(`  GET  /health   - health check`);
});
