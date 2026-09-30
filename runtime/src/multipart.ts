/**
 * multipart/form-data — parse and re-serialise.
 *
 * WHY THIS EXISTS: classify.ts scrapes `filename=` out of the raw body with a
 * regex, which is enough to say "a file was attached" but not enough to CHANGE
 * one. To tokenize the Email column of an uploaded CSV we have to find that
 * part's bytes exactly, replace them, and rebuild the body so the boundary
 * markers, headers and trailing CRLFs are all still correct.
 *
 * Deliberately hand-written: the runtime ships with almost no dependencies on
 * purpose, and a body parser is precisely the kind of code that should not be
 * a supply-chain risk in a security daemon.
 *
 * Implemented against RFC 7578 (multipart/form-data) and RFC 2046 §5.1
 * (multipart syntax). Byte-level throughout — a file part may be arbitrary
 * binary, and decoding it as UTF-8 to find a boundary would corrupt it.
 */

export interface Part {
  /** Raw header block of this part, verbatim. */
  headersRaw: string;
  /** Parsed headers, lowercased keys. */
  headers: Record<string, string>;
  /** The form field name from Content-Disposition. */
  name?: string;
  /** The filename, when this part is a file upload. */
  filename?: string;
  /** This part's Content-Type, when it declared one. */
  contentType?: string;
  /** The part's body bytes, excluding the trailing CRLF before the boundary. */
  body: Buffer;
}

export interface ParsedMultipart {
  boundary: string;
  parts: Part[];
  /** Anything before the first boundary — normally empty, preserved verbatim. */
  preamble: Buffer;
  /** Anything after the closing boundary — preserved verbatim. */
  epilogue: Buffer;
}

const CRLF = Buffer.from("\r\n");
const DASH2 = Buffer.from("--");

/** Pull the boundary out of a Content-Type header. */
export function boundaryOf(contentType: string): string | null {
  // RFC 2046: boundary may be quoted. Stop at ; or whitespace when unquoted.
  const m = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const b = m?.[1] ?? m?.[2];
  return b ? b : null;
}

export function isMultipart(contentType: string): boolean {
  return /^\s*multipart\/form-data/i.test(contentType);
}

function indexOfBuf(hay: Buffer, needle: Buffer, from: number): number {
  return hay.indexOf(needle, from);
}

function parseHeaderBlock(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r\n/)) {
    if (!line) continue;
    const i = line.indexOf(":");
    if (i === -1) continue;
    out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

/**
 * RFC 5987 / RFC 2183 parameter extraction.
 *
 * Browsers send `filename="customers.csv"`. Some send `filename*=UTF-8''…`
 * for non-ASCII names. Both are handled; the extended form wins because that
 * is what RFC 5987 says it is for.
 */
function dispositionParam(disposition: string, key: string): string | undefined {
  const ext = new RegExp(`${key}\\*\\s*=\\s*([^;]+)`, "i").exec(disposition);
  if (ext?.[1]) {
    const m = /^[^']*'[^']*'(.*)$/.exec(ext[1].trim());
    if (m?.[1]) { try { return decodeURIComponent(m[1]); } catch { /* fall through */ } }
  }
  const plain = new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*(?:"([^"]*)"|([^;]+))`, "i").exec(disposition);
  const v = plain?.[1] ?? plain?.[2];
  return v === undefined ? undefined : v.trim();
}

/**
 * Parse a multipart body. Returns null when the body does not actually conform
 * — the caller must treat that as "cannot inspect", never as "nothing here".
 */
export function parseMultipart(body: Buffer, contentType: string): ParsedMultipart | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;

  const delim = Buffer.concat([DASH2, Buffer.from(boundary)]);
  const first = indexOfBuf(body, delim, 0);
  if (first === -1) return null;

  const preamble = Buffer.from(body.subarray(0, first));
  const parts: Part[] = [];
  let epilogue: Buffer = Buffer.alloc(0);

  let pos = first;
  // Hard bound: a malformed body must not spin here.
  for (let guard = 0; guard < 10_000; guard++) {
    // `pos` sits on a delimiter. Step past it.
    const afterDelim = pos + delim.length;

    // Closing delimiter is "--boundary--".
    if (body.subarray(afterDelim, afterDelim + 2).equals(DASH2)) {
      epilogue = Buffer.from(body.subarray(afterDelim + 2));
      break;
    }

    // Skip the CRLF (or bare LF from a sloppy client) after the delimiter.
    let cursor = afterDelim;
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;
    else if (body[cursor] === 0x0a) cursor += 1;
    else return null; // not a well-formed boundary line

    // Headers run to the first blank line.
    const headerEnd = indexOfBuf(body, Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) return null;
    const headersRaw = body.subarray(cursor, headerEnd).toString("utf-8");
    const bodyStart = headerEnd + 4;

    // The part's body ends at the next delimiter, minus the CRLF that belongs
    // to the delimiter line rather than to the content.
    const next = indexOfBuf(body, delim, bodyStart);
    if (next === -1) return null;
    let bodyEnd = next;
    if (body[bodyEnd - 2] === 0x0d && body[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    else if (body[bodyEnd - 1] === 0x0a) bodyEnd -= 1;

    const headers = parseHeaderBlock(headersRaw);
    const disp = headers["content-disposition"] ?? "";
    parts.push({
      headersRaw,
      headers,
      name: dispositionParam(disp, "name"),
      filename: dispositionParam(disp, "filename"),
      contentType: headers["content-type"],
      body: Buffer.from(body.subarray(bodyStart, bodyEnd)),
    });

    pos = next;
  }

  return { boundary, parts, preamble, epilogue };
}

/**
 * Rebuild a multipart body from parsed parts.
 *
 * Header blocks are re-emitted verbatim, so a part we did not touch is
 * byte-identical to what the client sent. Only a part whose `body` the caller
 * replaced actually changes.
 */
export function serialiseMultipart(m: ParsedMultipart): Buffer {
  const delim = Buffer.concat([DASH2, Buffer.from(m.boundary)]);
  const chunks: Buffer[] = [];
  if (m.preamble.length) chunks.push(m.preamble);

  for (const p of m.parts) {
    chunks.push(delim, CRLF);
    chunks.push(Buffer.from(p.headersRaw, "utf-8"));
    chunks.push(CRLF, CRLF);
    chunks.push(p.body);
    chunks.push(CRLF);
  }

  chunks.push(delim, DASH2);
  if (m.epilogue.length) chunks.push(m.epilogue);
  else chunks.push(CRLF);

  return Buffer.concat(chunks);
}

/** Is this part a file upload rather than an ordinary form field? */
export function isFilePart(p: Part): boolean {
  return typeof p.filename === "string" && p.filename.length > 0;
}
