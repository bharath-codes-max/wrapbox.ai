/**
 * Who made this request, and what were they talking to?
 *
 * Evidence that says "unknown → some URL" is almost useless to the person
 * reading it. They need to see "Chrome → ChatGPT". Two cheap, honest signals
 * give us that once TLS is terminated:
 *
 *   the User-Agent header  → which browser or tool
 *   the destination host   → which AI service
 *
 * Neither requires the process to cooperate, and neither needs a per-vendor
 * integration: an unrecognised browser is reported as its real User-Agent
 * token rather than being forced into a category it does not belong to, and an
 * unrecognised host is reported as the host.
 *
 * A User-Agent can of course be forged. That does not matter for enforcement —
 * the DECISION is made on content, never on this — it only affects the label
 * in the evidence trail, which is why it is used for attribution and nothing
 * else.
 */

/** Browsers and tools, most specific first: Arc and Edge both also say "Chrome". */
const CLIENTS: { id: string; label: string; re: RegExp }[] = [
  { id: "arc", label: "Arc", re: /\bArc\// },
  { id: "edge", label: "Edge", re: /\bEdgA?\// },
  { id: "opera", label: "Opera", re: /\bOPR\/|\bOpera\// },
  { id: "vivaldi", label: "Vivaldi", re: /\bVivaldi\// },
  { id: "brave", label: "Brave", re: /\bBrave\// },
  { id: "firefox", label: "Firefox", re: /\bFirefox\// },
  { id: "chrome", label: "Chrome", re: /\bChrome\/|\bChromium\// },
  { id: "safari", label: "Safari", re: /\bSafari\// },
  { id: "curl", label: "curl", re: /^curl\// },
  { id: "wget", label: "wget", re: /^Wget\// },
  { id: "python", label: "Python", re: /\bpython-requests\/|\bPython\// },
  { id: "node", label: "Node", re: /\bnode(-fetch)?\/|\bundici\// },
  { id: "electron", label: "Desktop app", re: /\bElectron\// },
  { id: "claudecode", label: "Claude Code", re: /\bclaude-cli\/|\bClaude-?Code\//i },
  { id: "cursor", label: "Cursor", re: /\bCursor\//i },
  { id: "postman", label: "Postman", re: /\bPostmanRuntime\// },
];

export interface Client {
  id: string;
  label: string;
}

export function identifyClient(userAgent: string | undefined): Client {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { id: "unknown", label: "Unknown client" };

  for (const c of CLIENTS) {
    if (c.re.test(ua)) return { id: c.id, label: c.label };
  }

  // Unrecognised: report the product token it actually sent rather than
  // guessing. "SomeNewBrowser/2.1" is more useful than "unknown", and it is
  // how a tool we have never seen still gets named in the evidence trail.
  const token = ua.split(/[\s(]/)[0]?.slice(0, 40);
  return token
    ? { id: "other", label: token }
    : { id: "unknown", label: "Unknown client" };
}

/* ------------------------------------------------------------------ *
 * Destination
 * ------------------------------------------------------------------ */

const SERVICES: { id: string; label: string; re: RegExp }[] = [
  { id: "openai", label: "ChatGPT", re: /(^|\.)(chatgpt\.com|openai\.com)$/i },
  { id: "claude", label: "Claude", re: /(^|\.)(claude\.ai|anthropic\.com)$/i },
  { id: "gemini", label: "Gemini", re: /(^|\.)(gemini\.google\.com|generativelanguage\.googleapis\.com|aistudio\.google\.com)$/i },
  { id: "githubcopilot", label: "Copilot", re: /(^|\.)(copilot\.microsoft\.com|githubcopilot\.com)$/i },
  { id: "perplexity", label: "Perplexity", re: /(^|\.)perplexity\.ai$/i },
  { id: "mistral", label: "Mistral", re: /(^|\.)mistral\.ai$/i },
  { id: "cursor", label: "Cursor", re: /(^|\.)cursor\.(sh|com)$/i },
  { id: "github_dark", label: "GitHub", re: /(^|\.)github\.com$/i },
];

/**
 * Hosts that look like a model endpoint without being on any list.
 * This is what keeps the product honest about services nobody has catalogued:
 * an unknown AI host is still surfaced AS an AI host in the evidence.
 */
const LOOKS_LIKE_AI = /(^|[.-])(ai|llm|gpt|chat|copilot|assistant|claude|gemini|model)([.-]|$)/i;

export interface Service {
  id: string;
  label: string;
  /** True when this looks like an AI destination, recognised or not. */
  ai: boolean;
}

export function identifyService(host: string): Service {
  for (const s of SERVICES) {
    if (s.re.test(host)) return { id: s.id, label: s.label, ai: true };
  }
  if (LOOKS_LIKE_AI.test(host)) return { id: "mcp", label: host, ai: true };
  return { id: "", label: host, ai: false };
}

/* ------------------------------------------------------------------ *
 * Is this worth recording?
 * ------------------------------------------------------------------ */

/**
 * Background chatter is not evidence.
 *
 * The previous version of this recorded any POST to an AI host. That was still
 * far too loose: opening chatgpt.com fires conversation/init, f/conversation/
 * prepare, conversations/batch and reflections/time_spent before the person has
 * typed anything. All are POSTs, all carry bodies, none are anything the user
 * did. The trail filled up while the machine sat idle.
 *
 * So the test is now about the PAYLOAD, not the destination:
 *
 *   - anything not allowed (block / review) — always
 *   - anything where content was classified (a secret, code, PII)
 *   - any file upload, whatever it contained
 *
 * and nothing else. A clean prompt with nothing sensitive in it is not
 * recorded, because a clean prompt is not a security event — it is the product
 * working. Those are counted and reported, never silently dropped.
 *
 * The trade-off is deliberate and worth naming: this trail answers "what risky
 * thing happened", not "everything anyone ever sent". Pass --record-all when
 * you want the second thing.
 */
export function isSignificant(opts: {
  effect: "allow" | "constrain" | "block" | "review";
  contentKinds: string[];
  hasFileUpload: boolean;
  service: Service;
  bytes: number;
  method: string;
  recordAll?: boolean;
}): boolean {
  if (opts.recordAll) return true;
  // Anything not allowed is always evidence.
  if (opts.effect !== "allow") return true;
  // Something sensitive was recognised in the payload.
  if (opts.contentKinds.length > 0) return true;
  // A file left the machine, whatever was in it.
  if (opts.hasFileUpload) return true;
  return false;
}


/** Telemetry and analytics paths — noise even on an AI host. */
const NOISE_PATH = new RegExp(
  [
    // Analytics and crash reporting, including the vendors AI sites embed.
    "\\/(ces|statsc|telemetry|sentinel|beacon|metrics|analytics|rgstr|rum|sentry|datadog|csp-report)(\\/|$|\\?)",
    // Liveness and polling.
    "\\/(ping|heartbeat|health|healthz|keepalive|poll)(\\/|$|\\?)",
    // Logging endpoints.
    "\\/(log|logs|logging|event_log|event_logging|events?|track|tracking)(\\/|$|\\?)",
  ].join("|"),
  "i",
);

export function isNoisePath(path: string): boolean {
  return NOISE_PATH.test(path);
}
