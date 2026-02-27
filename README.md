# MCP Server - Base de Conhecimento

Servidor MCP (Model Context Protocol) em Node.js com transporte **SSE (Server-Sent Events)** para conectar ao n8n via HTTP Streamable.

## Ferramenta

- **`consultar_base_conhecimento`** – Lê o arquivo `regras.md` na raiz do projeto e retorna o texto.

## Tecnologias

- **@modelcontextprotocol/sdk** – SDK oficial MCP
- **Express** – Servidor HTTP
- **SSE** – GET para stream, POST para mensagens (compatível com n8n)

## Endpoints

| Método | Path   | Descrição |
|--------|--------|-----------|
| GET    | `/mcp` | Estabelece o stream SSE (n8n conecta aqui) |
| POST   | `/mcp` | Mensagens do cliente (`?sessionId=...`) |
| GET    | `/health` | Health check |

## Uso local

```bash
npm install
npm run build
npm start
```

Ou em desenvolvimento:

```bash
npm run dev
```

## Docker / Coolify

### Build e run

```bash
docker build -t mcp-base-conhecimento .
docker run -p 3000:3000 mcp-base-conhecimento
```

### Coolify

1. Crie um novo serviço **Dockerfile** no Coolify.
2. Aponte para o repositório ou faça upload do projeto (pasta `mcp-server`).
3. Porta: **3000**.
4. Variáveis opcionais: `PORT` (padrão 3000).

### URL no n8n

- **HTTP Streamable / SSE**: `https://seu-dominio/mcp`  
  O n8n fará GET para abrir o stream e POST para enviar mensagens (com `sessionId` na query).

## Arquivo `regras.md`

Edite `regras.md` na raiz do projeto (ou monte como volume no Docker) para alterar o conteúdo retornado pela ferramenta.

## Licença

MIT
