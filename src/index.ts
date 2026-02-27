import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import cors from "cors";
import express, { type Request, type Response } from "express";

const PORT = Number(process.env.PORT) || 3000;
/** Path único para MCP: GET = SSE, POST = mensagens (n8n HTTP Streamable) */
const MCP_PATH = "/mcp";

/** Timeout padrão (ms) para derrubar conexões SSE fantasmas/inativas */
const SSE_IDLE_TIMEOUT_MS =
  Number(process.env.MCP_SSE_IDLE_TIMEOUT_MS) || 5 * 60 * 1000; // 5 minutos

type TrackedTransport = {
  transport: SSEServerTransport;
  clientKey: string;
  timeout: NodeJS.Timeout;
};

// Mapa de sessão -> transport (para rotear POST com sessionId)
const transportsBySession = new Map<string, TrackedTransport>();
// Mapa de "cliente" -> transport (para fechar conexões antigas do mesmo cliente)
const transportsByClient = new Map<string, TrackedTransport>();

function getClientKey(req: Request): string {
  const explicitClientId =
    (req.query.clientId as string | undefined) ||
    (req.headers["x-client-id"] as string | undefined) ||
    (req.headers["x-n8n-session-id"] as string | undefined);

  if (explicitClientId) {
    return String(explicitClientId);
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown-ip";
  const ua = (req.headers["user-agent"] as string | undefined) || "unknown-ua";

  return `${ip}__${ua}`;
}

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
  const clientKey = getClientKey(req);

  const existing = transportsByClient.get(clientKey);
  if (existing) {
    console.log(
      "[MCP SSE] Nova conexão SSE recebida; fechando conexão anterior do mesmo cliente",
      {
        clientKey,
        oldSessionId: existing.transport.sessionId,
      }
    );
    clearTimeout(existing.timeout);
    try {
      await existing.transport.close();
    } catch (error) {
      console.log(
        "[MCP SSE] Erro ao fechar conexão SSE anterior",
        String(error)
      );
    }
    transportsBySession.delete(existing.transport.sessionId);
    transportsByClient.delete(clientKey);
  }

  const transport = new SSEServerTransport(MCP_PATH, res);
  const server = createServer();

  await server.connect(transport);
  await transport.start();

  const sessionId = transport.sessionId;
  console.log("[MCP SSE] Conexão SSE aberta", {
    sessionId,
    clientKey,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
  });

  const timeout = setTimeout(async () => {
    console.log("[MCP SSE] Timeout SSE atingido, fechando conexão", {
      sessionId,
      clientKey,
      timeoutMs: SSE_IDLE_TIMEOUT_MS,
    });
    transportsBySession.delete(sessionId);
    transportsByClient.delete(clientKey);
    try {
      await transport.close();
    } catch (error) {
      console.log(
        "[MCP SSE] Erro ao fechar conexão SSE por timeout",
        String(error)
      );
    }
  }, SSE_IDLE_TIMEOUT_MS);

  const tracked: TrackedTransport = { transport, clientKey, timeout };
  transportsBySession.set(sessionId, tracked);
  transportsByClient.set(clientKey, tracked);

  transport.onclose = () => {
    console.log("[MCP SSE] Conexão SSE fechada (onclose)", {
      sessionId,
      clientKey,
    });
    clearTimeout(timeout);
    transportsBySession.delete(sessionId);
    transportsByClient.delete(clientKey);
  };
});

// POST: recebe mensagens do cliente (sessionId na query ou header)
app.post(MCP_PATH, async (req: Request, res: Response) => {
  const sessionId =
    (req.query.sessionId as string) || (req.headers["mcp-session-id"] as string);

  if (!sessionId) {
    res.status(400).send("Missing sessionId (query or header mcp-session-id)");
    return;
  }

  const tracked = transportsBySession.get(sessionId);
  const transport = tracked?.transport;
  if (!transport) {
    res.status(404).send("Unknown session. Connect via GET /mcp first.");
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "mcp-base-conhecimento" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
