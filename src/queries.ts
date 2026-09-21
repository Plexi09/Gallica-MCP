/**
 * Parameterized SPARQL builders for BnF data.bnf.fr.
 */

// Sanitizers
export function sanitizeSparqlString(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}
export function sanitizeArk(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || /[^A-Za-z0-9:/.-]/.test(trimmed)) {
    throw new Error(
      `Invalid ARK identifier "${raw}": allowed chars are [A-Za-z0-9:/.-].`,
    );
  }
  return trimmed;
}
export function sanitizeIsbn(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || /[^0-9Xx\- ]/.test(trimmed)) {
    throw new Error(`Invalid ISBN "${raw}".`);
  }
  return sanitizeSparqlString(trimmed);
}

/**
 * Sanitize free text for a Virtuoso `bif:contains` full-text predicate.
 * Keeps letters, numbers, spaces, hyphens and apostrophes; apostrophes are
 * escaped by doubling (FTS single-quote convention). Throws when nothing
 * searchable remains.
 */
export function sanitizeFtsQuery(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s'\-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") {
    throw new Error(
      `Invalid full-text query "${raw}": nothing searchable left after sanitization.`,
    );
  }
  return cleaned.replace(/'/g, "''");
}

/**
 * Build a Virtuoso `bif:contains` match expression requiring every token
 * (e.g. "Les Misérables" becomes `'Les' AND 'Misérables'`). The data.bnf.fr
 * FTS index is accent-insensitive, so tokens keep their original spelling.
 * NOTE: in the query body, the triple binding the searched variable must
 * come BEFORE the `bif:contains` triple, otherwise Virtuoso rejects the
 * query (SP031).
 */
export function ftsMatchExpression(raw: string): string {
  return sanitizeFtsQuery(raw)
    .split(" ")
    .map((token) => `'${token}'`)
    .join(" AND ");
}

/**
 * Clamp pagination server-side.
 */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 10;
  return Math.min(100, Math.max(1, Math.floor(limit)));
}

export function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(10000, Math.max(0, Math.floor(offset)));
}

// PREFIX block
const PREFIXES = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX bnf-onto: <http://data.bnf.fr/ontology/bnf-onto/>
PREFIX rdarelationships: <http://rdvocab.info/RDARelationshipsWEMI/>
PREFIX rdagroup1elements: <http://rdvocab.info/ElementsGr1/>
PREFIX rdagroup2elements: <http://rdvocab.info/ElementsGr2/>
PREFIX bnfroles: <http://data.bnf.fr/vocabulary/roles/>
PREFIX marcrel: <http://id.loc.gov/vocabulary/relators/>
PREFIX owl: <http://www.w3.org/2002/07/owl#>`;

const ARK_BASE = "http://data.bnf.fr/ark:/12148/";

/** Resolve the URI used as subject of `foaf:focus` triples: always the bare
 * ARK URI (measured: `<ark> foaf:focus <ark#about>`, the `#about` form as
 * subject matches nothing). */
function focusUri(ark: string): string {
  const clean = sanitizeArk(ark).replace(/#.*$/, "");
  if (/^https?:\/\//.test(clean)) return clean;
  const bare = clean.replace(/^ark:\/12148\//, "");
  return `${ARK_BASE}${bare}`;
}

// Argument shapes (positional canonical + object for peer tools.ts)
export interface AuthorSearchArgs {
  name: string;
  limit: number;
  offset: number;
}

export interface WorksByAuthorArkArgs {
  ark: string;
  limit: number;
  offset: number;
}

export interface WorkTitleSearchArgs {
  title: string;
  author?: string;
  limit: number;
  offset: number;
}

export interface EditionsForWorkArkArgs {
  ark: string;
  limit: number;
  offset: number;
}

export interface ByIsbnArgs {
  isbn: string;
}

export interface AuthorDetailsArgs {
  ark: string;
}

export interface WorkDetailsArgs {
  ark: string;
}

function resolveAuthorSearch(
  nameOrArgs: string | AuthorSearchArgs,
  limit?: number,
  offset?: number,
): AuthorSearchArgs {
  if (typeof nameOrArgs === "object") return nameOrArgs;
  return {
    name: nameOrArgs,
    limit: limit ?? 10,
    offset: offset ?? 0,
  };
}

function resolveWorksByAuthorArk(
  arkOrArgs: string | WorksByAuthorArkArgs,
  limit?: number,
  offset?: number,
): WorksByAuthorArkArgs {
  if (typeof arkOrArgs === "object") return arkOrArgs;
  return { ark: arkOrArgs, limit: limit ?? 10, offset: offset ?? 0 };
}

function resolveWorkTitleSearch(
  titleOrArgs: string | WorkTitleSearchArgs,
  limit?: number,
  offset?: number,
  author?: string,
): WorkTitleSearchArgs {
  if (typeof titleOrArgs === "object") return titleOrArgs;
  return {
    title: titleOrArgs,
    author,
    limit: limit ?? 10,
    offset: offset ?? 0,
  };
}

function resolveEditionsForWorkArk(
  arkOrArgs: string | EditionsForWorkArkArgs,
  limit?: number,
  offset?: number,
): EditionsForWorkArkArgs {
  if (typeof arkOrArgs === "object") return arkOrArgs;
  return { ark: arkOrArgs, limit: limit ?? 20, offset: offset ?? 0 };
}

function resolveByIsbn(isbnOrArgs: string | ByIsbnArgs): ByIsbnArgs {
  if (typeof isbnOrArgs === "object") return isbnOrArgs;
  return { isbn: isbnOrArgs };
}

function resolveAuthorDetails(
  arkOrArgs: string | AuthorDetailsArgs,
): AuthorDetailsArgs {
  if (typeof arkOrArgs === "object") return arkOrArgs;
  return { ark: arkOrArgs };
}

function resolveWorkDetails(
  arkOrArgs: string | WorkDetailsArgs,
): WorkDetailsArgs {
  if (typeof arkOrArgs === "object") return arkOrArgs;
  return { ark: arkOrArgs };
}

// Author search: CONTAINS + LCASE on foaf:name, birth/death OPTIONAL
export function buildAuthorSearch(
  name: string,
  limit: number,
  offset: number,
): string;
export function buildAuthorSearch(args: AuthorSearchArgs): string;
export function buildAuthorSearch(
  nameOrArgs: string | AuthorSearchArgs,
  limit?: number,
  offset?: number,
): string {
  const { name, limit: lim, offset: off } = resolveAuthorSearch(
    nameOrArgs,
    limit,
    offset,
  );
  const fts = ftsMatchExpression(name);
  const l = clampLimit(lim);
  const o = clampOffset(off);
  return `${PREFIXES}
SELECT DISTINCT ?person ?ark ?name ?birth ?death
WHERE {
  ?ark foaf:focus ?person .
  FILTER(STRSTARTS(STR(?ark), "${ARK_BASE}"))
  ?person a foaf:Person ;
    foaf:name ?name .
  ?name bif:contains "${fts}" .
  OPTIONAL { ?person rdagroup2elements:dateOfBirth ?birth . }
  OPTIONAL { ?person rdagroup2elements:dateOfDeath ?death . }
}
ORDER BY ?name
LIMIT ${String(l)} OFFSET ${String(o)}`;
}

// Works by author ARK: foaf:focus
export function buildWorksByAuthorArk(
  ark: string,
  limit: number,
  offset: number,
): string;
export function buildWorksByAuthorArk(args: WorksByAuthorArkArgs): string;
export function buildWorksByAuthorArk(
  arkOrArgs: string | WorksByAuthorArkArgs,
  limit?: number,
  offset?: number,
): string {
  const { ark, limit: lim, offset: off } = resolveWorksByAuthorArk(
    arkOrArgs,
    limit,
    offset,
  );
  const uri = focusUri(ark);
  const l = clampLimit(lim);
  const o = clampOffset(off);
  return `${PREFIXES}
SELECT DISTINCT ?work ?workArk ?title ?date
WHERE {
  <${uri}> foaf:focus ?person .
  { ?work dcterms:creator ?person . }
  UNION
  { ?work dcterms:contributor ?person . }
  UNION
  { ?work marcrel:aut ?person . }
  UNION
  { ?work bnfroles:r70 ?person . }
  ?workArk foaf:focus ?work .
  FILTER(STRSTARTS(STR(?workArk), "${ARK_BASE}"))
  ?work dcterms:title ?title .
  OPTIONAL { ?work dcterms:date ?date . }
}
ORDER BY ?title
LIMIT ${String(l)} OFFSET ${String(o)}`;
}

// Work title search: dcterms:title FILTER + creator OPTIONAL
export function buildWorkTitleSearch(
  title: string,
  limit: number,
  offset: number,
): string;
export function buildWorkTitleSearch(args: WorkTitleSearchArgs): string;
export function buildWorkTitleSearch(
  titleOrArgs: string | WorkTitleSearchArgs,
  limitOrAuthor?: number | string,
  offset?: number,
  authorParam?: string,
): string {
  let resolved: WorkTitleSearchArgs;
  if (typeof titleOrArgs === "object") {
    resolved = titleOrArgs;
  } else if (typeof limitOrAuthor === "string") {
    resolved = {
      title: titleOrArgs,
      author: limitOrAuthor,
      limit: offset ?? 10,
      offset: authorParam !== undefined ? Number(authorParam) : 0,
    };
  } else {
    resolved = resolveWorkTitleSearch(
      titleOrArgs,
      limitOrAuthor,
      offset,
      authorParam,
    );
  }
  const fts = ftsMatchExpression(resolved.title);
  const authorFilter =
    resolved.author !== undefined && resolved.author.trim() !== ""
      ? `  FILTER(CONTAINS(LCASE(STR(?creatorName)), LCASE("${sanitizeSparqlString(resolved.author)}")))\n`
      : "";
  const l = clampLimit(resolved.limit);
  const o = clampOffset(resolved.offset);
  return `${PREFIXES}
SELECT DISTINCT ?work ?workArk ?title ?creatorName ?date
WHERE {
  ?workArk foaf:focus ?work .
  FILTER(STRSTARTS(STR(?workArk), "${ARK_BASE}"))
  ?work dcterms:title ?title .
  ?title bif:contains "${fts}" .
  OPTIONAL {
    ?work dcterms:creator ?creator .
    ?creator foaf:name ?creatorName .
  }
  OPTIONAL { ?work dcterms:date ?date . }
${authorFilter}}
ORDER BY ?title
LIMIT ${String(l)} OFFSET ${String(o)}`;
}

// Editions for work ARK: workManifested + date/title/publisher/
// electronicReproduction + isbn/ean OPTIONAL

export function buildEditionsForWorkArk(
  ark: string,
  limit: number,
  offset: number,
): string;
export function buildEditionsForWorkArk(args: EditionsForWorkArkArgs): string;
export function buildEditionsForWorkArk(
  arkOrArgs: string | EditionsForWorkArkArgs,
  limit?: number,
  offset?: number,
): string {
  const { ark, limit: lim, offset: off } = resolveEditionsForWorkArk(
    arkOrArgs,
    limit,
    offset,
  );
  const uri = focusUri(ark);
  const l = clampLimit(lim);
  const o = clampOffset(off);
  return `${PREFIXES}
SELECT DISTINCT ?edition ?editionArk ?title ?date ?publisher ?gallicaUrl ?isbn ?ean
WHERE {
  <${uri}> foaf:focus ?oeuvre .
  ?oeuvre rdarelationships:workManifested ?edition .
  ?editionArk foaf:focus ?edition .
  FILTER(STRSTARTS(STR(?editionArk), "${ARK_BASE}"))
  OPTIONAL { ?edition dcterms:title ?title . }
  OPTIONAL { ?edition dcterms:date ?date . }
  OPTIONAL { ?edition dcterms:publisher ?publisher . }
  OPTIONAL { ?edition rdarelationships:electronicReproduction ?gallicaUrl . }
  OPTIONAL { ?edition bnf-onto:isbn ?isbn . }
  OPTIONAL { ?edition bnf-onto:ean ?ean . }
}
ORDER BY ?date ?title
LIMIT ${String(l)} OFFSET ${String(o)}`;
}

// Lookup by ISBN: UNION isbn/ean + edition attrs + workManifested join
export function buildByIsbn(isbn: string): string;
export function buildByIsbn(args: ByIsbnArgs): string;
export function buildByIsbn(isbnOrArgs: string | ByIsbnArgs): string {
  const { isbn } = resolveByIsbn(isbnOrArgs);
  const clean = sanitizeIsbn(isbn);
  const digits = clean.replace(/[-\s]/g, "");
  return `${PREFIXES}
SELECT DISTINCT ?edition ?editionArk ?title ?date ?publisher ?workArk ?workTitle
WHERE {
  { ?edition bnf-onto:isbn "${clean}" . }
  UNION
  { ?edition bnf-onto:ean "${clean}" . }
  UNION
  { ?edition bnf-onto:isbn "${digits}" . }
  UNION
  { ?edition bnf-onto:ean "${digits}" . }
  ?editionArk foaf:focus ?edition .
  FILTER(STRSTARTS(STR(?editionArk), "${ARK_BASE}"))
  OPTIONAL { ?edition dcterms:title ?title . }
  OPTIONAL { ?edition dcterms:date ?date . }
  OPTIONAL { ?edition dcterms:publisher ?publisher . }
  OPTIONAL {
    ?work rdarelationships:workManifested ?edition .
    ?workArk foaf:focus ?work .
    OPTIONAL { ?work dcterms:title ?workTitle . }
  }
}`;
}

// Author details
export function buildAuthorDetails(ark: string): string;
export function buildAuthorDetails(args: AuthorDetailsArgs): string;
export function buildAuthorDetails(
  arkOrArgs: string | AuthorDetailsArgs,
): string {
  const { ark } = resolveAuthorDetails(arkOrArgs);
  const uri = focusUri(ark);
  return `${PREFIXES}
SELECT DISTINCT ?person ?prefLabel ?name ?birth ?death ?birthPlace ?deathPlace ?bio ?sameAs
WHERE {
  <${uri}> foaf:focus ?person .
  OPTIONAL { ?person skos:prefLabel ?prefLabel . }
  OPTIONAL { ?person foaf:name ?name . }
  OPTIONAL { ?person rdagroup2elements:dateOfBirth ?birth . }
  OPTIONAL { ?person rdagroup2elements:dateOfDeath ?death . }
  OPTIONAL { ?person rdagroup2elements:placeOfBirth ?birthPlace . }
  OPTIONAL { ?person rdagroup2elements:placeOfDeath ?deathPlace . }
  OPTIONAL { ?person bnf-onto:biographicalNote ?bio . }
  OPTIONAL { ?person owl:sameAs ?sameAs . }
}`;
}

// Work details
export function buildWorkDetails(ark: string): string;
export function buildWorkDetails(args: WorkDetailsArgs): string;
export function buildWorkDetails(
  arkOrArgs: string | WorkDetailsArgs,
): string {
  const { ark } = resolveWorkDetails(arkOrArgs);
  const uri = focusUri(ark);
  return `${PREFIXES}
SELECT DISTINCT ?work ?title ?date ?language ?subject ?description ?firstYear ?creatorName
WHERE {
  <${uri}> foaf:focus ?work .
  OPTIONAL { ?work dcterms:title ?title . }
  OPTIONAL { ?work dcterms:date ?date . }
  OPTIONAL { ?work dcterms:language ?language . }
  OPTIONAL { ?work dcterms:subject ?subject . }
  OPTIONAL { ?work dcterms:description ?description . }
  OPTIONAL { ?work bnf-onto:firstYear ?firstYear . }
  OPTIONAL {
    ?work dcterms:creator ?creator .
    ?creator foaf:name ?creatorName .
  }
}`;
}
