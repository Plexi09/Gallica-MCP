/**
 * BnF data.bnf.fr SPARQL fetch wrapper + politeness.
 */

export const ENDPOINT: string =
  process.env["BNF_SPARQL_URL"] ?? "https://data.bnf.fr/sparql";

export const USER_AGENT: string =
  "Gallica-MCP/0.1 (+https://github.com/Gallica-mcp)";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_GAP_MS = 1_000;
const CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_RETRIES = 3;

export interface SparqlBindingValue {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

export interface SparqlJsonResults {
  head: { vars: string[] };
  results: {
    bindings: Record<string, SparqlBindingValue>[];
  };
}

export interface ExecuteSparqlOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

type Row = Record<string, string>;

// In-memory cache
interface CacheEntry {
  expiresAt: number;
  data: SparqlJsonResults;
}

const cache = new Map<string, CacheEntry>();

function cacheGet(query: string): SparqlJsonResults | undefined {
  const entry = cache.get(query);
  if (entry === undefined) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(query);
    return undefined;
  }
  return entry.data;
}

function cacheSet(query: string, data: SparqlJsonResults): void {
  cache.set(query, { expiresAt: Date.now() + CACHE_TTL_MS, data });
}

export function clearSparqlCache(): void {
  cache.clear();
}


let tail: Promise<void> = Promise.resolve();
let lastStartMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withPoliteness<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release: () => void = () => undefined;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const elapsed = Date.now() - lastStartMs;
    const wait = MIN_GAP_MS - elapsed;
    if (wait > 0) await sleep(wait);
    lastStartMs = Date.now();
    return await fn();
  } finally {
    release();
  }
}

// Fetch
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function backoffMs(attempt: number): number {
  // Exponential backoff: 500ms, 1000ms, 2000ms (+ jitter up to 200ms)
  return 500 * 2 ** attempt + Math.floor(Math.random() * 200);
}

function buildRequestUrl(query: string, timeoutMs: number): string {
  const params = new URLSearchParams({
    "default-graph-uri": "",
    format: "json",
    timeout: String(timeoutMs),
    query,
  });
  return `${ENDPOINT}?${params.toString()}`;
}

/**
 * Execute a read-only SPARQL SELECT query against data.bnf.fr.
 *
 * GET with ?default-graph-uri=&format=json&timeout=<ms>&query=<encoded>,
 * Accept: application/sparql-results+json, custom UA, AbortSignal.timeout
 * default 10s, sequential queue (>=1s gap), 15-min in-memory cache,
 * 3x exponential-backoff retry on 5xx/429/network errors.
 *
 * @throws Error (ToolError-style message) on HTTP, network, timeout or
 *   parse failure — never swallows errors into empty results.
 */
export async function executeSparql(
  query: string,
  opts?: ExecuteSparqlOptions,
): Promise<SparqlJsonResults> {
  const timeoutMs =
    opts?.timeoutMs !== undefined ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const cached = cacheGet(query);
  if (cached !== undefined) return cached;

  return withPoliteness(async () => {
    const url = buildRequestUrl(query, timeoutMs);
    let lastError: unknown = undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const timeoutSignal: AbortSignal = AbortSignal.timeout(timeoutMs);
      const signal: AbortSignal =
        opts?.signal !== undefined
          ? AbortSignal.any([opts.signal, timeoutSignal])
          : timeoutSignal;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/sparql-results+json",
            "User-Agent": USER_AGENT,
          },
          signal,
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const snippet = body.slice(0, 300);
          const message =
            `BnF SPARQL request failed: HTTP ${String(response.status)}` +
            ` ${response.statusText} for query (${String(query.length)} chars)` +
            (snippet !== "" ? ` — ${snippet}` : "");
          if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
            lastError = new Error(message);
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new Error(message);
        }
        const data = (await response.json()) as SparqlJsonResults;
        if (
          data.head === undefined ||
          data.results === undefined ||
          !Array.isArray(data.results.bindings)
        ) {
          throw new Error(
            "BnF SPARQL request failed: unexpected JSON shape (missing head/results.bindings).",
          );
        }
        cacheSet(query, data);
        return data;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.startsWith("BnF SPARQL request failed: HTTP") &&
          !isRetryableStatus(
            Number(err.message.match(/HTTP (\d+)/)?.[1] ?? 0),
          )
        ) {
          throw err;
        }
        const message =
          err instanceof Error ? err.message : String(err);
        const retryable =
          attempt < MAX_RETRIES &&
          (message.includes("HTTP 429") ||
            /HTTP 5\d\d/.test(message) ||
            err instanceof TypeError ||
            err instanceof DOMException);
        if (!retryable) {
          if (err instanceof Error) throw err;
          throw new Error(`BnF SPARQL request failed: ${message}`);
        }
        lastError = err;
        await sleep(backoffMs(attempt));
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(
      `BnF SPARQL request failed after ${String(MAX_RETRIES + 1)} attempts: ${String(lastError)}`,
    );
  });
}

// Result helpers
/**
 * Flatten SPARQL JSON bindings to plain string rows.
 * Each binding value becomes its `.value` (URI or literal lexical form).
 */
export function simplifyBindings(json: SparqlJsonResults): Row[] {
  return json.results.bindings.map((binding) => {
    const row: Row = {};
    for (const [key, term] of Object.entries(binding)) {
      row[key] = term.value;
    }
    return row;
  });
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Render rows as a Markdown table (maxRows default 20).
 * Appends a truncation note when rows exceed maxRows.
 */
export function toMarkdownTable(rows: Row[], maxRows = 20): string {
  if (rows.length === 0) return "No results.";
  const first: Row | undefined = rows[0];
  if (first === undefined) return "No results.";
  const columns: string[] = Object.keys(first);
  const shown: Row[] = rows.slice(0, maxRows);
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const lines: string[] = shown.map(
    (row) =>
      `| ${columns.map((col) => escapeMarkdownCell(row[col] ?? "")).join(" | ")} |`,
  );
  const table = [header, separator, ...lines].join("\n");
  if (rows.length > shown.length) {
    return (
      `${table}\n\n_Showing ${String(shown.length)} of ${String(rows.length)} rows (truncated)._`
    );
  }
  return table;
}
