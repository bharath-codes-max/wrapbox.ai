/**
 * Extensible content-classifier framework (§2).
 *
 * classify.ts holds the four battle-tested detectors the product shipped with
 * (secret, source_code, pii, credential_file). This module adds a REUSABLE
 * framework so a new enterprise class — financial, PHI, legal, confidential and
 * whatever an enterprise needs next — is a declarative table of weighted
 * signals, not another hand-rolled branch. classify.ts runs every detector
 * registered here and merges the result.
 *
 * WHY MULTI-SIGNAL, NOT ONE KEYWORD. A single keyword ("invoice", "patient")
 * is a false-positive machine: it blocks a person's real work, and a product
 * that blocks real work gets uninstalled. Each detector therefore requires
 * several INDEPENDENT signals from at least two distinct signal GROUPS before
 * it fires, and reports a confidence separate from any authorization decision
 * (§17: confidence never widens authority — it is evidence, nothing more).
 *
 * Every detector is `local: true` — it runs in the daemon on the device. A
 * cloud/exact-data detector is an enterprise integration (external blocker C)
 * and would register with `local: false`; none does here.
 */

/** How a signal reached its conclusion — surfaced in Evidence. */
export type EvidenceType = "pattern" | "checksum" | "dictionary" | "structure" | "context";

export interface Signal {
  id: string;
  /** A coarse group; a detector requires hits from >= 2 distinct groups, so a
   *  single lexical match can never fire a class on its own. */
  group: string;
  weight: number;
  evidence: EvidenceType;
  /** Returns the number of DISTINCT hits (0 = no signal). */
  count: (text: string, ctx: DetectContext) => number;
}

export interface DetectContext {
  filenames: string[];
  contentType: string;
}

export interface ClassDetector {
  id: string;
  version: string;
  /** The class FAMILY this emits — the capability name (content.<family>). */
  family: string;
  local: boolean;
  /** Human label for a finding. */
  label: string;
  signals: Signal[];
  /** Minimum weighted score to fire. */
  threshold: number;
  /** Minimum number of distinct signal GROUPS that must contribute. */
  minGroups: number;
}

export interface ClassFinding {
  family: string;
  label: string;
  /** Total distinct hits across contributing signals. */
  count: number;
  /** Weighted score achieved. */
  score: number;
  /** 0–1, evidence strength only. NOT an authorization input. */
  confidence: number;
  /** Which signal groups contributed, for Evidence. */
  groups: string[];
  evidence: EvidenceType[];
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

const REGISTRY = new Map<string, ClassDetector>();

export function registerClassDetector(d: ClassDetector): void { REGISTRY.set(d.id, d); }
export function unregisterClassDetector(id: string): void { REGISTRY.delete(id); }
export function classDetectors(): ClassDetector[] { return [...REGISTRY.values()]; }
/** Every family a locally-deployed detector can emit — the runtime's honest
 *  content vocabulary beyond the four coarse kinds. */
export function detectableFamilies(): string[] {
  return [...new Set([...REGISTRY.values()].filter((d) => d.local).map((d) => d.family))];
}

/** Run one detector over already-decoded text. Null if it does not fire. */
export function runClassDetector(d: ClassDetector, text: string, ctx: DetectContext): ClassFinding | null {
  let score = 0;
  let count = 0;
  const groups = new Set<string>();
  const evidence = new Set<EvidenceType>();
  for (const s of d.signals) {
    const n = s.count(text, ctx);
    if (n <= 0) continue;
    score += s.weight * Math.min(n, 4);   // cap a single signal's contribution
    count += n;
    groups.add(s.group);
    evidence.add(s.evidence);
  }
  if (score < d.threshold || groups.size < d.minGroups) return null;
  // Confidence scales with how far past the bar we are, saturating at 1. Kept
  // deliberately separate from the block/allow decision.
  const confidence = Math.max(0, Math.min(1, (score - d.threshold) / (d.threshold * 1.5) + 0.5));
  return { family: d.family, label: d.label, count, score, confidence, groups: [...groups], evidence: [...evidence] };
}

/** Run every registered local detector; return the findings that fired. */
export function classifyExtended(text: string, ctx: DetectContext): ClassFinding[] {
  const out: ClassFinding[] = [];
  for (const d of REGISTRY.values()) {
    if (!d.local) continue;
    const f = runClassDetector(d, text, ctx);
    if (f) out.push(f);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Small signal helpers
 * ------------------------------------------------------------------ */

/** Count DISTINCT case-folded matches of a global regex. */
function distinct(re: RegExp, text: string): number {
  re.lastIndex = 0;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(text)) !== null && guard++ < 5000) {
    seen.add(m[0].toLowerCase());
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return seen.size;
}

/** Count how many distinct dictionary terms appear (word-boundary, case-insensitive). */
function dictHits(terms: string[], text: string): number {
  const lower = text.toLowerCase();
  let n = 0;
  for (const t of terms) {
    // Cheap contains first, then a boundary check to avoid substring noise.
    if (lower.includes(t) && new RegExp(`(^|[^a-z0-9])${escapeRe(t)}([^a-z0-9]|$)`, "i").test(text)) n++;
  }
  return n;
}
function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* ------------------------------------------------------------------ *
 * FINANCIAL — the flagship detector (§1)
 *
 * Signals across FIVE groups: currency amounts, accounting vocabulary,
 * invoice/statement structure, financial column headers, and fiscal-period
 * markers. Requires >= 2 groups and a real score, so "we grew revenue" in an
 * email does not read as a financial document, but a P&L, an invoice, or an
 * exported ledger does.
 * ------------------------------------------------------------------ */

const FINANCIAL_DETECTOR: ClassDetector = {
  id: "wrapbox.financial", version: "1.0.0", family: "financial", local: true,
  label: "financial_data", threshold: 5, minGroups: 2,
  signals: [
    {
      id: "currency_amounts", group: "amounts", weight: 2, evidence: "pattern",
      // $1,234.56 / €1.234,56 / ₹12,34,567 / USD 1000 / 1,234.00 in a money column.
      // The decimal group is OPTIONAL — a required trailing group after a `+`
      // quantifier is the classic ReDoS shape (it forces backtracking through
      // the group when it fails); making it optional keeps the scan linear.
      count: (t) => distinct(/(?:USD|EUR|GBP|INR|JPY|CAD|AUD|CHF|CNY)\s?\d[\d.,]{0,32}|[$€£₹¥]\s?\d[\d.,]{0,32}|\b\d{1,3}(?:,\d{2,3}){1,20}(?:\.\d{2})?\b/g, t),
    },
    {
      id: "accounting_terms", group: "vocabulary", weight: 1, evidence: "dictionary",
      count: (t) => dictHits([
        "revenue", "ebitda", "gross margin", "net income", "net profit", "operating income",
        "accounts payable", "accounts receivable", "balance sheet", "cash flow", "income statement",
        "profit and loss", "p&l", "depreciation", "amortization", "amortisation", "fiscal year",
        "gross profit", "cost of goods sold", "cogs", "retained earnings", "shareholder",
        "liabilities", "equity", "dividend", "capital expenditure", "capex", "opex", "ledger",
      ], t),
    },
    {
      id: "statement_structure", group: "structure", weight: 2, evidence: "structure",
      count: (t) => dictHits([
        "invoice", "invoice number", "invoice no", "statement of account", "amount due",
        "total due", "subtotal", "sub-total", "purchase order", "remittance", "bill to",
        "payment terms", "net 30", "net 60", "tax id", "vat", "gst", "wire transfer",
      ], t),
    },
    {
      id: "financial_columns", group: "columns", weight: 1, evidence: "structure",
      count: (t) => {
        // Header-row style: several money column names on one line.
        const head = t.split(/\r?\n/, 40).find((l) => /[,;\t]/.test(l) && /(amount|balance|debit|credit|unit price|quantity|total|price)/i.test(l));
        if (!head) return 0;
        return dictHits(["amount", "balance", "debit", "credit", "unit price", "quantity", "total", "price", "currency"], head);
      },
    },
    {
      id: "fiscal_periods", group: "periods", weight: 1, evidence: "pattern",
      count: (t) => distinct(/\b(?:Q[1-4]\s?(?:FY)?\d{2,4}|FY\s?\d{2,4}|fiscal\s+(?:year|quarter)|H[12]\s?\d{4})\b/gi, t),
    },
  ],
};

/* ------------------------------------------------------------------ *
 * PHI — protected health information (§2, HIPAA-shaped)
 * ------------------------------------------------------------------ */

const PHI_DETECTOR: ClassDetector = {
  id: "wrapbox.phi", version: "1.0.0", family: "phi", local: true,
  label: "protected_health_information", threshold: 5, minGroups: 2,
  signals: [
    {
      id: "icd10", group: "codes", weight: 2, evidence: "pattern",
      // ICD-10-CM: a letter, two digits, optional .subcode — but require a
      // clinical word nearby via the diagnosis dictionary group to avoid noise.
      count: (t) => distinct(/\b[A-TV-Z]\d{2}(?:\.\d{1,4})?\b/g, t),
    },
    {
      id: "cpt_npi", group: "codes", weight: 2, evidence: "pattern",
      // NPI is 10 digits; CPT is 5 digits — gated by vocabulary group below.
      count: (t) => distinct(/\b(?:NPI[:#\s]*\d{10}|CPT[:#\s]*\d{5})\b/gi, t),
    },
    {
      id: "clinical_terms", group: "vocabulary", weight: 1, evidence: "dictionary",
      count: (t) => dictHits([
        "diagnosis", "patient", "prescription", "prescribed", "dosage", "mg daily",
        "medical record", "mrn", "clinical", "symptom", "treatment", "physician",
        "hospital", "discharge summary", "lab result", "blood pressure", "allergy",
        "immunization", "immunisation", "referral", "specimen", "pathology",
      ], t),
    },
    {
      id: "mrn_structure", group: "structure", weight: 2, evidence: "structure",
      count: (t) => distinct(/\b(?:MRN|medical\s+record\s+(?:no|number|#))[:#\s]*[A-Z0-9-]{5,}\b/gi, t),
    },
  ],
};

/* ------------------------------------------------------------------ *
 * LEGAL — contracts, privilege, filings (§2)
 * ------------------------------------------------------------------ */

const LEGAL_DETECTOR: ClassDetector = {
  id: "wrapbox.legal", version: "1.0.0", family: "legal", local: true,
  label: "legal_document", threshold: 4, minGroups: 2,
  signals: [
    {
      id: "privilege_markers", group: "privilege", weight: 3, evidence: "context",
      count: (t) => dictHits(["attorney-client privilege", "privileged and confidential", "attorney work product", "work product doctrine"], t),
    },
    {
      id: "contract_language", group: "vocabulary", weight: 1, evidence: "dictionary",
      count: (t) => dictHits([
        "whereas", "hereinafter", "indemnify", "indemnification", "governing law",
        "jurisdiction", "in witness whereof", "party of the first part", "counterparts",
        "force majeure", "arbitration", "confidentiality clause", "non-disclosure",
        "severability", "warranties", "covenants", "liability shall", "terminate this agreement",
      ], t),
    },
    {
      id: "agreement_structure", group: "structure", weight: 2, evidence: "structure",
      count: (t) => dictHits(["this agreement", "this contract", "terms and conditions", "master services agreement", "statement of work", "memorandum of understanding"], t),
    },
    {
      id: "citations", group: "citations", weight: 2, evidence: "pattern",
      // Reporter-style citation: "410 U.S. 113", "123 F.3d 456".
      count: (t) => distinct(/\b\d{1,4}\s+(?:U\.?S\.?|F\.?\d?d?|S\.?\s?Ct\.?|Cal\.?|N\.?Y\.?)\s+\d{1,4}\b/g, t),
    },
  ],
};

/* ------------------------------------------------------------------ *
 * CONFIDENTIAL — document classification markings (§2)
 *
 * Detects EXPLICIT handling labels an organisation stamps on documents. This is
 * a marking detector, distinct from ownership/provenance (external blocker C):
 * it proves the document is LABELLED confidential, not who it belongs to.
 * ------------------------------------------------------------------ */

const CONFIDENTIAL_DETECTOR: ClassDetector = {
  id: "wrapbox.confidential", version: "1.0.0", family: "confidential", local: true,
  label: "classified_document", threshold: 3, minGroups: 1,
  signals: [
    {
      id: "banner_markings", group: "marking", weight: 3, evidence: "context",
      count: (t) => distinct(/\b(?:CONFIDENTIAL|STRICTLY\s+CONFIDENTIAL|INTERNAL\s+USE\s+ONLY|RESTRICTED|PROPRIETARY|DO\s+NOT\s+DISTRIBUTE|COMPANY\s+CONFIDENTIAL|CLASSIFIED)\b/g, t),
    },
    {
      id: "tlp", group: "marking", weight: 3, evidence: "pattern",
      count: (t) => distinct(/\bTLP:(?:RED|AMBER(?:\+STRICT)?|GREEN)\b/gi, t),
    },
  ],
};

/* ------------------------------------------------------------------ *
 * Registration — the ONE place these become real capabilities.
 * ------------------------------------------------------------------ */

registerClassDetector(FINANCIAL_DETECTOR);
registerClassDetector(PHI_DETECTOR);
registerClassDetector(LEGAL_DETECTOR);
registerClassDetector(CONFIDENTIAL_DETECTOR);

export { FINANCIAL_DETECTOR, PHI_DETECTOR, LEGAL_DETECTOR, CONFIDENTIAL_DETECTOR };
