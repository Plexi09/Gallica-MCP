import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeSparql, simplifyBindings, toMarkdownTable } from "./bnf.js";
import {
  buildAuthorSearch,
  buildWorksByAuthorArk,
  buildWorkTitleSearch,
  buildEditionsForWorkArk,
  buildByIsbn,
  buildAuthorDetails,
  buildWorkDetails,
} from "./queries.js";

type Format = "json" | "markdown";
type Row = Record<string, string>;

const formatSchema = z.enum(["json", "markdown"]).default("markdown");
const limitSchema = (def: number, max: number) =>
  z.number().int().min(1).max(max).default(def);
const offsetSchema = z.number().int().min(0).default(0);

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function render(rows: Row[], format: Format): string {
  if (format === "json") {
    return JSON.stringify(rows, null, 2);
  }
  return toMarkdownTable(rows);
}

function ok(format: Format, rows: Row[], limit: number) {
  return {
    content: [{ type: "text" as const, text: render(rows, format) }],
    structuredContent: {
      rows,
      count: rows.length,
      has_more: rows.length >= limit,
    },
  };
}

function miss(what: string) {
  return {
    content: [{ type: "text" as const, text: `No results found in BnF data.bnf.fr for ${what}.` }],
    isError: true as const,
  };
}

const FORBIDDEN = /\b(CONSTRUCT|ASK|DESCRIBE|INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|SERVICE)\b/i;

function stripComments(query: string): string {
  return query
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("#");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

function assertSelectOnly(query: string): string | null {
  const stripped = stripComments(query).trim();
  if (!stripped) return "SPARQL query is empty.";
  if (FORBIDDEN.test(stripped)) {
    return "Only SELECT queries are allowed (CONSTRUCT/ASK/DESCRIBE/INSERT/DELETE/LOAD/CLEAR/DROP/CREATE/SERVICE are forbidden).";
  }
  const withoutPrefixes = stripped.replace(/^\s*PREFIX\s+[^\n]*$/gim, "").trim();
  if (!/^SELECT\b/i.test(withoutPrefixes)) {
    return "Only SELECT queries are allowed (query must start with PREFIX/SELECT, comments allowed).";
  }
  return null;
}

function applyLimitOffset(query: string, limit: number, offset: number): string {
  let q = query.trim().replace(/;\s*$/, "");
  if (!/\bLIMIT\s+\d+/i.test(q)) q += ` LIMIT ${limit}`;
  if (!/\bOFFSET\s+\d+/i.test(q)) q += ` OFFSET ${offset}`;
  return q;
}

export function registerGallicaTools(server: McpServer): void {
  server.registerTool(
    "search_authors",
    {
      description:
        "Search BnF data.bnf.fr authors by name. Returns ARKs (e.g. cb11907966z for Victor Hugo) to use with get_author_details.",
      inputSchema: {
        name: z.string().min(1).describe("Author name to search in BnF data.bnf.fr"),
        limit: limitSchema(10, 50),
        offset: offsetSchema,
        format: formatSchema,
      },
    },
    async ({ name, limit, offset, format }) => {
      const lim = clamp(limit, 1, 50);
      const off = clamp(offset, 0, Number.MAX_SAFE_INTEGER);
      const sparql = buildAuthorSearch({ name, limit: lim, offset: off });
      const json = await executeSparql(sparql);
      const rows = simplifyBindings(json);
      if (rows.length === 0) return miss(`author name "${name}"`);
      return ok(format, rows, lim);
    },
  );

  server.registerTool(
    "search_works",
    {
      description:
        "Search BnF data.bnf.fr works by title (optionally filtered by author name). Returns work ARKs to use with get_work_details/list_editions.",
      inputSchema: {
        title: z.string().min(1).describe("Work title to search in BnF data.bnf.fr"),
        author: z.string().optional().describe("Optional author name filter"),
        limit: limitSchema(10, 50),
        offset: offsetSchema,
        format: formatSchema,
      },
    },
    async ({ title, author, limit, offset, format }) => {
      const lim = clamp(limit, 1, 50);
      const off = clamp(offset, 0, Number.MAX_SAFE_INTEGER);
      // If `author` looks like an ARK, resolve works via the ARK builder;
      // otherwise run a title (+ optional author name) search.
      const isArk = author !== undefined && /cb\d+[a-z0-9]/i.test(author);
      const sparql = isArk
        ? buildWorksByAuthorArk({ ark: author as string, limit: lim, offset: off })
        : buildWorkTitleSearch({ title, author, limit: lim, offset: off });
      const json = await executeSparql(sparql);
      const rows = simplifyBindings(json);
      if (rows.length === 0) return miss(`work title "${title}"`);
      return ok(format, rows, lim);
    },
  );

  server.registerTool(
    "get_author_details",
    {
      description:
        "Get details for one BnF data.bnf.fr author by ARK (e.g. cb11907966z). ARKs come from search_authors. Never mint them.",
      inputSchema: {
        ark: z.string().min(1).describe("BnF author ARK identifier, e.g. cb11907966z"),
      },
    },
    async ({ ark }) => {
      const sparql = buildAuthorDetails({ ark });
      const json = await executeSparql(sparql);
      const rows = simplifyBindings(json);
      if (rows.length === 0) return miss(`author ARK "${ark}"`);
      return {
        content: [{ type: "text" as const, text: render(rows, "markdown") }],
        structuredContent: { rows, count: rows.length, has_more: false },
      };
    },
  );

  server.registerTool(
    "get_work_details",
    {
      description:
        "Get details for one BnF data.bnf.fr work by ARK. ARKs come from search_works; Gallica URLs come from the electronicReproduction field, never mint ARKs.",
      inputSchema: {
        ark: z.string().min(1).describe("BnF work ARK identifier"),
      },
    },
    async ({ ark }) => {
      const sparql = buildWorkDetails({ ark });
      const json = await executeSparql(sparql);
      const rows = simplifyBindings(json);
      if (rows.length === 0) return miss(`work ARK "${ark}"`);
      return {
        content: [{ type: "text" as const, text: render(rows, "markdown") }],
        structuredContent: { rows, count: rows.length, has_more: false },
      };
    },
  );

  server.registerTool(
    "list_editions",
    {
      description:
        "List editions of a BnF data.bnf.fr work given the work ARK (e.g. cb12258414j for Le Medecin malgre lui). Gallica URLs come from electronicReproduction.",
      inputSchema: {
        work_ark: z.string().min(1).describe("BnF work ARK identifier"),
        limit: limitSchema(20, 50),
        offset: offsetSchema,
        format: formatSchema,
      },
    },
    async ({ work_ark, limit, offset, format }) => {
      const lim = clamp(limit, 1, 50);
      const off = clamp(offset, 0, Number.MAX_SAFE_INTEGER);
      const sparql = buildEditionsForWorkArk({ ark: work_ark, limit: lim, offset: off });
      const json = await executeSparql(sparql);
      const rows = simplifyBindings(json);
      if (rows.length === 0) return miss(`editions of work ARK "${work_ark}"`);
      return ok(format, rows, lim);
    },
  );

  server.registerTool(
    "search_by_isbn",
    {
      description:
        "Search BnF data.bnf.fr editions by ISBN. Returns the matching edition and its work ARK for get_work_details/list_editions.",
      inputSchema: {
        isbn: z.string().min(1).describe("ISBN to look up in BnF data.bnf.fr (hyphens allowed)"),
      },
    },
    async ({ isbn }) => {
      const sparql = buildByIsbn({ isbn });
      const json = await executeSparql(sparql);
      const rows = simplifyBindings(json);
      if (rows.length === 0) return miss(`ISBN "${isbn}"`);
      return {
        content: [{ type: "text" as const, text: render(rows, "markdown") }],
        structuredContent: { rows, count: rows.length, has_more: false },
      };
    },
  );

  server.registerTool(
    "sparql_select",
    {
      description:
        "Run a read-only SELECT query against the BnF data.bnf.fr SPARQL endpoint. SELECT only (PREFIX preamble and # comments allowed); LIMIT/OFFSET are auto-appended.",
      inputSchema: {
        query: z.string().min(1).describe("SPARQL SELECT query for https://data.bnf.fr/sparql"),
        limit: limitSchema(20, 100),
        offset: offsetSchema,
        format: formatSchema,
      },
    },
    async ({ query, limit, offset, format }) => {
      const lim = clamp(limit, 1, 100);
      const off = clamp(offset, 0, Number.MAX_SAFE_INTEGER);
      const refusal = assertSelectOnly(query);
      if (refusal) {
        return {
          content: [{ type: "text" as const, text: refusal }],
          isError: true as const,
        };
      }
      const finalQuery = applyLimitOffset(query, lim, off);
      const json = await executeSparql(finalQuery);
      const rows = simplifyBindings(json);
      if (rows.length === 0) return miss("custom SPARQL SELECT query");
      return ok(format, rows, lim);
    },
  );
}
