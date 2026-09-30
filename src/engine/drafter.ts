// ============================================================================
// Intent drafter — deterministic natural-language → clause extractor used by
// Intent Studio's "Draft contract". Pattern-driven and predictable (simulated
// compiler); the production product compiles through the Policy IR.
// ============================================================================

import type { ContractClause, IntentContract } from "../model/types";
import { contractCoverage } from "./coverage";

const EXTERNAL_DESTINATIONS: ContractClause["destinations"] = [
  "APPROVED_AI", "UNAPPROVED_AI", "GENERIC_EXTERNAL", "UNKNOWN_EXTERNAL", "PARTNER",
];

// A clause needs a human only when the sentence asks for one. "approved"
// (an adjective, as in "approved AI") is NOT a request for approval.
const NEEDS_REVIEW = /\b(review|approval|sign-?off)\b|\bapprove\b/;
const FORBIDS = /\b(never|forbidden|block(ed)?)\b|must not|may not|cannot/;
const SENDS = /transmi|upload|\bsen[dt]\b|\bsending\b|\bleav(e|es|ing)\b|\bshar(e|ed|es|ing)\b|\bexport|\btransfer|\bpast(e|ed|ing)\b/;

export function draftClauses(text: string): ContractClause[] {
  const clauses: ContractClause[] = [];
  const sentences = text.split(/(?<=\.)\s+/).filter((x) => x.trim().length > 4);
  let i = 0;
  for (const sRaw of sentences) {
    const s = sRaw.toLowerCase();
    i += 1;
    const dataClasses: string[] = [];
    if (s.includes("email")) dataClasses.push("PII.EMAIL");
    if (s.includes("phone")) dataClasses.push("PII.PHONE");
    if (s.includes("credential") || s.includes("secret") || s.includes("api key") || s.includes("password")) {
      dataClasses.push("CREDENTIAL.API_KEY", "CREDENTIAL.PRIVATE_KEY", "CREDENTIAL.PASSWORD");
    }
    if (/\bsource code\b|\bcode\b/.test(s)) dataClasses.push("SOURCE_CODE");
    if (s.includes("customer id") || s.includes("customer identifier")) dataClasses.push("CUSTOM.CUSTOMER_ID");
    if (s.includes("compensation") || s.includes("salary")) dataClasses.push("HR.COMPENSATION");
    if (s.includes("health") || /\bphi\b/.test(s) || s.includes("patient")) dataClasses.push("HEALTH.PHI");
    if (/\bcards?\b/.test(s)) dataClasses.push("PCI.CARD");

    let effect: ContractClause["effect"] = "ALLOW";
    let transform: ContractClause["transform"];
    if (s.includes("tokeniz")) { effect = "CONSTRAIN"; transform = "REVERSIBLE_TOKENIZE"; }
    else if (s.includes("redact")) { effect = "CONSTRAIN"; transform = "REDACT"; }
    else if (FORBIDS.test(s)) effect = "BLOCK";
    else if (NEEDS_REVIEW.test(s)) effect = "REVIEW";

    const destinations: ContractClause["destinations"] =
      s.includes("external") || s.includes("outside") ? EXTERNAL_DESTINATIONS
      : s.includes("approved ai") ? ["APPROVED_AI"]
      : "ANY";

    const actions: ContractClause["actions"] =
      SENDS.test(s) ? ["NETWORK_SEND", "DATA_EXPORT"]
      : /\bread(s|ing)?\b/.test(s) ? ["READ", "SECRET_ACCESS"]
      : s.includes("deploy") ? ["DEPLOY"]
      : s.includes("delete") || s.includes("destructive") ? ["DELETE"]
      : "ANY";

    // MCP: "MCP" in the sentence makes it a tool-call rule. Tool names are the
    // snake_case words (optionally server.tool); "unregistered" targets unknown
    // servers; "main" / ".env" become argument patterns.
    let mcp: ContractClause["mcp"];
    if (/\bmcp\b/.test(s)) {
      const tools = [...new Set((sRaw.match(/\b(?:[a-z]+\.)?[a-z]+_[a-z_]+\b/g) ?? []))];
      const server = s.includes("github") ? "github" : s.includes("filesystem") || s.includes("file tool") ? "filesystem" : undefined;
      const qualified = tools.map((t) => (t.includes(".") || !server ? t : `${server}.${t}`));
      const args: Record<string, string> = {};
      if (/\bto main\b|\bmain branch\b|straight to main/.test(s)) args.branch = "^main$";
      if (s.includes("secrets file") || s.includes(".env")) args.path = "(^|/)\\.env$|credentials";
      mcp = {
        ...(s.includes("unregistered") ? { registered: false } : {}),
        ...(qualified.length ? { tools: qualified }
          : /\bpush/.test(s) ? { tools: [`${server ?? "github"}.push_files`] }
          : /\bwrit/.test(s) && /\bfiles?\b/.test(s) ? { tools: [`${server ?? "filesystem"}.write_file`] }
          : /\bdelet/.test(s) && server ? { tools: [`${server}.delete_file`] } : {}),
        ...(Object.keys(args).length ? { args } : {}),
      };
    }

    clauses.push({
      id: `cl-draft-${i}`,
      text: sRaw.trim().replace(/\.$/, ""),
      dataClasses,
      destinations,
      actions,
      effect,
      transform,
      ...(mcp ? { mcp, actions: "ANY" as const, destinations: "ANY" as const, dataClasses: [] } : {}),
      requiredCapabilities: mcp ? [mcp.args?.path ? "cap-ep-mcp-stdio" : "cap-gw-mcp"]
        : dataClasses.some((d) => d.startsWith("HEALTH.")) ? ["cap-ocr", "cap-net-file"]
        : dataClasses.some((d) => d.startsWith("HR.") || d.startsWith("LEGAL.")) ? ["cap-semantic", "cap-net-file"]
        : ["cap-net-file"],
      failClosed: effect !== "ALLOW",
    });
  }
  return clauses;
}

/** Coverage of a drafted set of clauses — same single function everything uses. */
export function coverageRollup(clauses: ContractClause[]): IntentContract["coverage"] {
  return contractCoverage({ clauses });
}
