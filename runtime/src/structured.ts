/**
 * Structured-document parsing — the field awareness CONSTRAIN needs.
 *
 * classify.ts answers "does this contain a card number?" by regexing raw bytes.
 * That is enough to BLOCK, and useless for CONSTRAIN: to tokenize the Email
 * column and leave Name alone, the runtime has to know which bytes belong to
 * which column. This module provides that.
 *
 * Hand-written, zero dependencies — same reasoning as multipart.ts. A parser
 * that runs on every outbound byte in a security daemon should not be a
 * transitive supply-chain risk.
 *
 * CSV follows RFC 4180: comma-separated, double-quote quoting, "" as an escaped
 * quote inside a quoted field, CRLF or LF line endings.
 *
 * FORMATS DELIBERATELY NOT SUPPORTED: XLSX (a ZIP of XML — needs a real
 * dependency), PDF, DOCX. They are detected and reported as unparseable so the
 * caller can fail closed. Silently forwarding a document we cannot transform
 * would turn CONSTRAIN into ALLOW, which is the exact failure this feature
 * exists to prevent.
 */

export type DocFormat = "csv" | "tsv" | "json" | "text" | "xlsx" | "unknown";

export interface Table {
  headers: string[];
  rows: string[][];
  /** Which delimiter was used, so serialisation round-trips. */
  delim: string;
  /** Line ending seen in the source, preserved on output. */
  eol: string;
}

/* ------------------------------------------------------------------ *
 * Format detection
 * ------------------------------------------------------------------ */

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" — a ZIP
const PDF_MAGIC = Buffer.from("%PDF-");

/**
 * Identify the document. Filename is a hint, bytes are the authority — a user
 * renaming secrets.xlsx to notes.csv must not change how it is handled.
 */
export function detectFormat(body: Buffer, filename = "", contentType = ""): DocFormat {
  if (body.subarray(0, 4).equals(XLSX_MAGIC)) return "xlsx";       // also .docx/.pptx/.zip
  if (body.subarray(0, 5).equals(PDF_MAGIC)) return "unknown";      // PDF: not parseable here

  const head = body.subarray(0, 4096).toString("utf-8");
  const trimmed = head.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // Confirm by actually parsing — a stray "{" in prose is not JSON.
    try { JSON.parse(body.toString("utf-8")); return "json"; } catch { /* not JSON */ }
  }
  if (/\bjson\b/i.test(contentType)) return "json";

  const name = filename.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".tsv")) return "tsv";
  if (name.endsWith(".csv") || /\bcsv\b/i.test(contentType)) return "csv";

  // Heuristic: two or more lines whose delimiter count agrees.
  for (const d of [",", "\t", ";"]) {
    const lines = head.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
    if (lines.length < 2) break;
    const counts = lines.map((l) => l.split(d).length);
    if (counts[0] > 1 && counts.every((c) => c === counts[0])) return d === "\t" ? "tsv" : "csv";
  }
  return body.length && !body.subarray(0, 512).includes(0) ? "text" : "unknown";
}

/** True when this format can be transformed. Anything else must fail closed. */
export function isTransformable(f: DocFormat): boolean {
  return f === "csv" || f === "tsv" || f === "json" || f === "text";
}

/** Why a format cannot be transformed — shown to the user on the block page. */
export function untransformableReason(f: DocFormat): string {
  if (f === "xlsx") return "Excel/Office files are a compressed archive that Wrapbox cannot yet open, so the protected fields inside cannot be masked. Export to CSV and upload that.";
  return "Wrapbox cannot read the structure of this file, so it cannot mask the protected fields inside it.";
}

/* ------------------------------------------------------------------ *
 * CSV — RFC 4180
 * ------------------------------------------------------------------ */

export function parseTable(text: string, delim = ","): Table | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // "" is one literal quote
        else inQuotes = false;
      } else field += ch;
      continue;
    }

    if (ch === '"' && field === "") { inQuotes = true; sawAny = true; continue; }
    if (ch === delim) { row.push(field); field = ""; sawAny = true; continue; }
    if (ch === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
    sawAny = true;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!sawAny || !rows.length) return null;

  const headers = rows.shift() ?? [];
  if (!headers.length) return null;
  return { headers, rows, delim, eol };
}

function quoteField(v: string, delim: string): string {
  // RFC 4180: quote when the value contains the delimiter, a quote, or a newline.
  if (v.includes(delim) || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

export function serialiseTable(t: Table): string {
  const line = (cells: string[]) => cells.map((c) => quoteField(c, t.delim)).join(t.delim);
  return [line(t.headers), ...t.rows.map(line)].join(t.eol) + t.eol;
}

/* ------------------------------------------------------------------ *
 * Column matching
 * ------------------------------------------------------------------ */

/**
 * Does this column header refer to the protected field the rule named?
 *
 * Matching is deliberately forgiving on FORM (case, spaces, underscores,
 * hyphens) and strict on MEANING — "email" matches "Email Address" and
 * "customer_email", but never "emailed_at". A rule that says protect Email
 * must not miss the column because a spreadsheet called it "E-Mail".
 */
export function columnMatches(header: string, want: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_\-.]+/g, "");
  const h = norm(header);
  const w = norm(want);
  if (h === w) return true;
  // Substring, but only on a token boundary in the original header, so
  // "email" hits "customer_email" and "Email Address" and not "emailedat".
  const tokens = header.toLowerCase().split(/[\s_\-.]+/).filter(Boolean);
  return tokens.some((t) => t === w) || (h.startsWith(w) && h.length - w.length <= 12 && /address|id|no|number/.test(h.slice(w.length)));
}

/** Column indices whose header matches any of the named fields. */
export function matchColumns(headers: string[], wanted: string[]): number[] {
  const out: number[] = [];
  headers.forEach((h, i) => {
    if (wanted.some((w) => columnMatches(h, w))) out.push(i);
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * JSON walking
 * ------------------------------------------------------------------ */

/**
 * Visit every string leaf in a JSON value, giving the visitor the key that
 * holds it. Returning a string replaces the leaf; returning undefined leaves it.
 * Mutates a structural clone, never the input.
 */
export function mapJsonStrings(value: unknown, visit: (key: string, val: string) => string | undefined): unknown {
  const walk = (v: unknown, key: string): unknown => {
    if (typeof v === "string") {
      const replaced = visit(key, v);
      return replaced === undefined ? v : replaced;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, k);
      return out;
    }
    return v;
  };
  return walk(value, "");
}
