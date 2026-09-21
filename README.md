# Gallica-MCP

MCP server for searching the BnF (Bibliothèque nationale de France) via the `data.bnf.fr` SPARQL endpoint (`https://data.bnf.fr/sparql`).

Search authors and works, resolve ARK identifiers, list editions (with Gallica links via `electronicReproduction`), look up by ISBN, or run your own read-only `SELECT` queries. Responses come back as Markdown tables (default) or JSON, plus structured `rows` for agents.

Data source: **data.bnf.fr (BnF)**. Data reuse under **Licence Ouverte / Open Licence** — please cite the source (`data.bnf.fr, BnF`) in downstream uses.

## Prerequisites

- Node.js 20+

## Install

```bash
npm install
npm run build
```

The stdio entrypoint is `dist/index.js`; the remote HTTP entrypoint is `dist/http.js` (serves `/mcp`, honors `PORT`, default `8000`).

```bash
BNF_SPARQL_URL=https://data.bnf.fr/sparql node dist/index.js
PORT=8000 BNF_SPARQL_URL=https://data.bnf.fr/sparql node dist/http.js
```

## Client setup

### Claude Code

Project scope (committed `.mcp.json` in this repo):

```bash
claude mcp add Gallica -- node ./dist/index.js
```

Or copy `.mcp.json`:

```json
{
  "mcpServers": {
    "Gallica": {
      "command": "node",
      "args": ["./dist/index.js"],
      "env": { "BNF_SPARQL_URL": "https://data.bnf.fr/sparql" }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json` (see `examples/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "Gallica": {
      "command": "npx",
      "args": ["-y", "Gallica-mcp"],
      "env": { "BNF_SPARQL_URL": "https://data.bnf.fr/sparql" }
    }
  }
}
```

From source, use an absolute path instead: `node /absolute/path/to/Gallica-MCP/dist/index.js`. Then restart Claude Desktop.

### Codex

Codex uses TOML (`~/.codex/config.toml`). See `examples/codex-config.toml`:

```toml
[mcp_servers.Gallica]
command = "npx"
args = ["-y", "Gallica-mcp"]
startup_timeout_sec = 20

[mcp_servers.Gallica.env]
BNF_SPARQL_URL = "https://data.bnf.fr/sparql"
```

Or via CLI:

```bash
codex mcp add Gallica -- npx -y Gallica-mcp
```

### Opencode

See `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "Gallica": {
      "type": "local",
      "command": ["npx", "-y", "Gallica-mcp"],
      "enabled": true,
      "environment": { "BNF_SPARQL_URL": "https://data.bnf.fr/sparql" }
    }
  }
}
```

### Remote HTTP

```bash
docker build -t Gallica-mcp .
docker run -p 8000:8000 -e BNF_SPARQL_URL=https://data.bnf.fr/sparql Gallica-mcp
```

Then point your client at `http://localhost:8000/mcp`.

## Tools

| Tool | Parameters | Description |
| --- | --- | --- |
| `search_authors` | `name` (string, required), `limit` (1–50, default 10), `offset` (default 0), `format` (`json`\|`markdown`, default `markdown`) | Search BnF data.bnf.fr authors by name; returns ARKs for `get_author_details`. |
| `search_works` | `title` (string, required), `author` (optional name or ARK), `limit` (1–50, default 10), `offset`, `format` | Search BnF data.bnf.fr works by title; returns work ARKs for `get_work_details` / `list_editions`. |
| `get_author_details` | `ark` (required, e.g. `cb11907966z`) | Author details from BnF data.bnf.fr by ARK. Never mint ARKs, use `search_authors` first. |
| `get_work_details` | `ark` (required) | Work details from BnF data.bnf.fr by ARK. Gallica URLs come from `electronicReproduction`. |
| `list_editions` | `work_ark` (required), `limit` (1–50, default 20), `offset`, `format` | Editions of a BnF work ARK; Gallica links via `electronicReproduction`. |
| `search_by_isbn` | `isbn` (required, hyphens allowed) | Edition lookup in BnF data.bnf.fr by ISBN; returns the work ARK. |
| `sparql_select` | `query` (SELECT only), `limit` (1–100, default 20), `offset`, `format` | Raw read-only SELECT against `https://data.bnf.fr/sparql`. `PREFIX` preamble and `#` comments allowed; `CONSTRUCT`/`ASK`/`DESCRIBE`/`INSERT`/`DELETE`/`LOAD`/`CLEAR`/`DROP`/`CREATE`/`SERVICE` rejected; `LIMIT`/`OFFSET` auto-appended. |

Every list/detail tool returns `{ content, structuredContent: { rows, count, has_more } }`.
A business miss (zero bindings) returns `isError: true` with a `No results found in BnF data.bnf.fr …` message.
