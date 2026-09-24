/**
 * Canonical Data Type Registry — the ONE vocabulary of protected data.
 *
 * Every surface (the LLM extraction schema, the validator's alias table, the
 * compiler, the runtime detectors, the transforms, the evidence and the UI)
 * refers to protected data by a registry id. Nothing else may carry its own
 * list of classes: the drift-guard tests in the compiler and the runtime fail
 * if a class name appears anywhere that is not resolvable here.
 *
 * Ids are hierarchical (`FAMILY.SUBFAMILY.TYPE`) so a clause can name any
 * level and match by prefix: `PII` covers `PII.CONTACT.EMAIL`. A type is a
 * CLAIM ABOUT DATA, not a detector — a type with no detector registered is
 * legal and is exactly what makes UNDERSTOOD_ONLY mechanical.
 *
 * Tenant types live under `CUSTOM.<tenant>.<TYPE>` and are indistinguishable to
 * the compiler from built-ins once registered.
 */
export const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };
export const TRANSFORM_IDS = [
    "REDACT", "MASK", "REVERSIBLE_TOKENIZE", "HASH", "DROP_FIELD",
    "GENERALIZE", "DATE_SHIFT", "FORMAT_PRESERVING", "LIMIT", "REWRITE",
];
const STD_EVIDENCE = ["label", "count", "confidence", "detector", "detector_version", "unit_path", "field_names"];
const TOKENIZABLE = { REVERSIBLE_TOKENIZE: "supported", REDACT: "supported", MASK: "supported", HASH: "supported", DROP_FIELD: "supported", FORMAT_PRESERVING: "unsafe" };
const REDACT_ONLY = { REDACT: "supported", DROP_FIELD: "supported", REVERSIBLE_TOKENIZE: "unsafe", MASK: "unsafe" };
const NO_TRANSFORM = { REDACT: "not_applicable", MASK: "not_applicable", REVERSIBLE_TOKENIZE: "not_applicable", HASH: "not_applicable", DROP_FIELD: "supported" };
const ALL_ACTIONS = ["ALLOW", "CONSTRAIN", "REVIEW", "BLOCK"];
const NO_CONSTRAIN = ["ALLOW", "REVIEW", "BLOCK"];
function t(id, label, aliases, o = {}) {
    const parent = id.includes(".") ? id.slice(0, id.lastIndexOf(".")) : undefined;
    return {
        id, ...(parent ? { parent } : {}), label,
        aliases: aliases.map(norm),
        inputs: o.inputs ?? ["text", "table", "structured"],
        transforms: o.transforms ?? TOKENIZABLE,
        actions: o.actions ?? ALL_ACTIONS,
        locality: o.locality ?? "device",
        ...(o.tenantConfig ? { tenantConfig: o.tenantConfig } : {}),
        defaults: o.defaults ?? { minCount: 1, minConfidence: "medium" },
        evidence: o.evidence ?? STD_EVIDENCE,
        status: o.status ?? "stable",
        ...(o.regulatory ? { regulatory: o.regulatory } : {}),
        ...(o.legacyKind ? { legacyKind: o.legacyKind } : {}),
    };
}
/** Normalise a phrase for alias matching: lower-case, non-alphanumerics → single space. */
export function norm(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
/** Light stemming for alias tokens: "numbers" → "number", "addresses" → "address". */
export function stem(w) {
    if (w.length > 4 && w.endsWith("ies"))
        return w.slice(0, -3) + "y";
    if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w))
        return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
        return w.slice(0, -1);
    return w;
}
/* ------------------------------------------------------------------ *
 * The catalogue. Families first (prefix-matchable), then types.
 * ------------------------------------------------------------------ */
export const BUILTIN_TYPES = [
    // ── PII ──────────────────────────────────────────────────────────────
    t("PII", "Personal data (any)", ["pii", "personal data", "personal information", "personally identifiable information", "customer pii", "customer data", "customer personal data", "personal details", "contact details", "contact information"], { regulatory: ["GDPR", "CCPA"], legacyKind: "pii" }),
    t("PII.CONTACT", "Contact details", ["contact data", "contact info"], { legacyKind: "pii" }),
    t("PII.CONTACT.EMAIL", "Email address", ["email", "emails", "email address", "email addresses", "e mail", "customer email", "customer emails", "customer email addresses"], { legacyKind: "pii" }),
    t("PII.CONTACT.PHONE", "Phone number", ["phone", "phones", "phone number", "phone numbers", "telephone", "mobile number", "mobile numbers", "cell number", "customer phone", "customer phone numbers"], { legacyKind: "pii" }),
    t("PII.CONTACT.ADDRESS", "Postal address", ["address", "addresses", "postal address", "home address", "street address", "physical address", "mailing address"], { legacyKind: "pii", status: "declared" }),
    t("PII.CONTACT.NAME", "Person name", ["name", "names", "full name", "full names", "person name", "customer name", "customer names", "employee name"], { legacyKind: "pii", status: "declared" }),
    t("PII.IDENTITY", "Identity attributes", ["identity data", "identity attributes"], { legacyKind: "pii" }),
    t("PII.IDENTITY.DOB", "Date of birth", ["dob", "date of birth", "birth date", "birthdate", "birthday"], { transforms: { ...TOKENIZABLE, DATE_SHIFT: "supported", GENERALIZE: "supported" }, legacyKind: "pii", status: "declared" }),
    t("PII.IDENTITY.AGE", "Age", ["age", "ages"], { transforms: { GENERALIZE: "supported", REDACT: "supported" }, legacyKind: "pii", status: "declared" }),
    t("PII.IDENTITY.GENDER", "Gender", ["gender", "sex"], { transforms: REDACT_ONLY, legacyKind: "pii", status: "declared" }),
    t("PII.ONLINE", "Online identifiers", ["online identifiers", "device identifiers"], { legacyKind: "pii" }),
    t("PII.ONLINE.IP_ADDRESS", "IP address", ["ip", "ip address", "ip addresses"], { transforms: { ...REDACT_ONLY, HASH: "supported", GENERALIZE: "supported" }, defaults: { minCount: 5, minConfidence: "medium" }, legacyKind: "pii" }),
    t("PII.ONLINE.MAC_ADDRESS", "MAC address", ["mac address", "mac addresses"], { transforms: REDACT_ONLY, legacyKind: "pii", status: "declared" }),
    t("PII.ONLINE.USERNAME", "Username", ["username", "usernames", "user name", "login name"], { transforms: TOKENIZABLE, legacyKind: "pii", status: "declared" }),
    t("PII.BULK", "Bulk personal data (many records)", ["bulk pii", "bulk personal data", "customer list", "customer lists", "mailing list", "contact list", "pii export", "customer export", "customer database"], { defaults: { minCount: 5, minConfidence: "medium", bulkCount: 5 }, legacyKind: "pii" }),
    // ── Government identifiers ──────────────────────────────────────────
    t("GOV_ID", "Government identifier (any)", ["government id", "government identifier", "government identifiers", "national id", "national identifier", "national identity number", "id number", "identity document number"], { legacyKind: "pii" }),
    t("GOV_ID.US.SSN", "US Social Security number", ["ssn", "ssns", "social security", "social security number", "social security numbers"], { regulatory: ["GLBA", "CCPA"], legacyKind: "pii" }),
    t("GOV_ID.US.ITIN", "US ITIN", ["itin"], { legacyKind: "pii", status: "declared" }),
    t("GOV_ID.US.PASSPORT", "US passport number", ["passport", "passport number", "passport numbers"], { legacyKind: "pii", status: "declared" }),
    t("GOV_ID.US.DRIVERS_LICENSE", "US driver's license", ["drivers license", "driver license", "driving licence", "driving license"], { legacyKind: "pii", status: "declared" }),
    t("GOV_ID.IN.AADHAAR", "India Aadhaar number", ["aadhaar", "aadhar", "uidai", "aadhaar number"], { legacyKind: "pii" }),
    t("GOV_ID.IN.PAN", "India PAN", ["pan number", "permanent account number", "india pan"], { legacyKind: "pii", status: "declared" }),
    t("GOV_ID.UK.NINO", "UK National Insurance number", ["national insurance", "national insurance number", "nino"], { legacyKind: "pii", status: "declared" }),
    t("GOV_ID.UK.NHS", "UK NHS number", ["nhs number", "nhs numbers"], { legacyKind: "pii", status: "declared" }),
    t("GOV_ID.CA.SIN", "Canada SIN", ["sin number", "social insurance number"], { legacyKind: "pii", status: "declared" }),
    t("GOV_ID.AU.TFN", "Australia TFN", ["tax file number", "tfn"], { legacyKind: "pii", status: "declared" }),
    // ── PCI ──────────────────────────────────────────────────────────────
    t("PCI", "Payment card data (any)", ["pci", "pci data", "card data", "payment card data", "cardholder data", "credit card data", "card details", "card numbers"], { regulatory: ["PCI DSS"], transforms: { MASK: "supported", REDACT: "supported", REVERSIBLE_TOKENIZE: "supported", HASH: "supported", DROP_FIELD: "supported", FORMAT_PRESERVING: "unsafe" }, legacyKind: "pii" }),
    t("PCI.PAN", "Primary account number", ["pan", "card number", "credit card", "credit card number", "credit cards", "debit card", "debit card number", "card"], { transforms: { MASK: "supported", REDACT: "supported", REVERSIBLE_TOKENIZE: "supported", HASH: "supported", DROP_FIELD: "supported" }, legacyKind: "pii" }),
    t("PCI.CVV", "Card verification value", ["cvv", "cvc", "cvv2", "security code", "card security code"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "pii", status: "declared" }),
    t("PCI.TRACK_DATA", "Magnetic stripe track data", ["track data", "magnetic stripe", "track 1", "track 2"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "pii", status: "declared" }),
    // ── Financial ────────────────────────────────────────────────────────
    t("FINANCIAL", "Financial business data (any)", ["financial", "financial data", "finance data", "financial business data", "financial information", "financials", "finance", "revenue", "revenue data", "accounting data", "accounts"], { transforms: REDACT_ONLY, legacyKind: "financial" }),
    t("FINANCIAL.ACCOUNT", "Bank account identifiers", ["bank account", "bank accounts", "account number", "account numbers", "bank account number", "iban", "routing number", "swift", "bic"], { transforms: TOKENIZABLE, legacyKind: "pii" }),
    t("FINANCIAL.ACCOUNT.IBAN", "IBAN", ["iban", "ibans", "iban number"], { transforms: TOKENIZABLE, legacyKind: "pii" }),
    t("FINANCIAL.ACCOUNT.US_ABA", "US ABA routing number", ["aba", "aba routing", "routing number", "routing numbers"], { transforms: TOKENIZABLE, legacyKind: "pii" }),
    t("FINANCIAL.ACCOUNT.SWIFT_BIC", "SWIFT / BIC", ["swift code", "bic code", "swift bic"], { transforms: TOKENIZABLE, legacyKind: "pii", status: "declared" }),
    t("FINANCIAL.STATEMENT", "Financial statements", ["financial statement", "financial statements", "balance sheet", "income statement", "p and l", "profit and loss", "cash flow statement", "quarterly results", "annual results"], { transforms: REDACT_ONLY, legacyKind: "financial" }),
    t("FINANCIAL.PRICING", "Pricing", ["pricing", "price list", "price lists", "pricing information", "quotes", "price quotes", "discount schedule"], { transforms: REDACT_ONLY, legacyKind: "financial" }),
    t("FINANCIAL.FORECAST", "Forecasts and projections", ["forecast", "forecasts", "projections", "financial projections", "budget", "budgets"], { transforms: REDACT_ONLY, legacyKind: "financial", status: "declared" }),
    t("FINANCIAL.TAX_ID", "Tax identifier", ["tax id", "tax identifier", "ein", "vat number", "gstin", "tin"], { transforms: TOKENIZABLE, legacyKind: "pii", status: "declared" }),
    // ── PHI ──────────────────────────────────────────────────────────────
    t("PHI", "Protected health information (any)", ["phi", "protected health information", "health data", "health information", "medical data", "medical information", "medical records", "patient data", "patient information", "patient records", "clinical data"], { regulatory: ["HIPAA"], transforms: { ...TOKENIZABLE, DATE_SHIFT: "supported" }, legacyKind: "phi" }),
    t("PHI.MRN", "Medical record number", ["mrn", "medical record number", "medical record numbers", "patient id", "patient ids", "patient identifier"], { legacyKind: "phi" }),
    t("PHI.NPI", "Provider NPI", ["npi", "national provider identifier"], { legacyKind: "phi" }),
    t("PHI.ICD10", "ICD-10 codes", ["icd 10", "icd codes", "diagnosis code", "diagnosis codes"], { transforms: REDACT_ONLY, legacyKind: "phi" }),
    t("PHI.CPT", "CPT procedure codes", ["cpt", "cpt code", "cpt codes", "procedure code", "procedure codes"], { transforms: REDACT_ONLY, legacyKind: "phi" }),
    t("PHI.DIAGNOSIS", "Diagnoses and conditions", ["diagnosis", "diagnoses", "medical condition", "medical conditions", "health condition"], { transforms: REDACT_ONLY, legacyKind: "phi", status: "declared" }),
    t("PHI.MEDICATION", "Medications", ["medication", "medications", "prescription", "prescriptions", "drug names"], { transforms: REDACT_ONLY, legacyKind: "phi", status: "declared" }),
    t("PHI.CLINICAL_NOTE", "Clinical documents", ["clinical note", "clinical notes", "clinical document", "clinical documents", "discharge summary", "lab results", "lab report"], { transforms: REDACT_ONLY, legacyKind: "phi" }),
    t("PHI.INSURANCE_ID", "Health insurance identifier", ["insurance id", "insurance number", "member id", "policy number", "health plan id"], { legacyKind: "phi", status: "declared" }),
    // ── Credentials — never transformable, never CONSTRAIN ───────────────
    t("CREDENTIAL", "Credential or secret (any)", ["credential", "credentials", "secret", "secrets", "key", "keys", "aws key", "aws keys", "other credentials", "signing key", "certificate private key", "login credentials", "auth credentials"], { inputs: ["text", "table", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, defaults: { minCount: 1, minConfidence: "medium" }, legacyKind: "secret" }),
    t("CREDENTIAL.PRIVATE_KEY", "Private key", ["private key", "private keys", "rsa key", "ssh key", "ssh private key", "pgp key", "pem key"], { inputs: ["text", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.PRIVATE_KEY.PEM", "PEM private key", ["pem private key"], { inputs: ["text", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.PRIVATE_KEY.OPENSSH", "OpenSSH private key", ["openssh private key", "openssh key"], { inputs: ["text", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.PRIVATE_KEY.PGP", "PGP private key", ["pgp private key"], { inputs: ["text", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.PRIVATE_KEY.PKCS12", "PKCS#12 keystore", ["pkcs12", "p12", "pfx", "keystore"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "credential_file" }),
    t("CREDENTIAL.API_KEY", "API key (provider-specific)", ["api key", "api keys", "provider api key", "service key", "cloud key"], { inputs: ["text", "table", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.TOKEN", "Authentication token", ["token", "auth token", "authentication token", "access token", "session token", "refresh token", "oauth token", "bearer token", "personal access token", "pat"], { inputs: ["text", "table", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.TOKEN.JWT", "JSON Web Token", ["jwt", "json web token", "jwts"], { inputs: ["text", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.PASSWORD", "Password", ["password", "passwords", "passphrase", "passwd"], { inputs: ["text", "table", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.CLIENT_SECRET", "Client secret", ["client secret", "client secrets", "app secret", "application secret", "oauth client secret"], { inputs: ["text", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.CONNECTION_STRING", "Database / service connection string", ["connection string", "connection strings", "database url", "database connection", "db credentials", "database password"], { inputs: ["text", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "secret" }),
    t("CREDENTIAL.CLOUD_SERVICE_ACCOUNT", "Cloud service-account key file", ["service account key", "service account json", "gcp service account", "cloud credentials file"], { inputs: ["structured", "text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "credential_file" }),
    t("CREDENTIAL.GENERIC_HIGH_ENTROPY", "Generic high-entropy secret", ["generic secret", "high entropy secret", "hardcoded secret", "hard coded secret"], { inputs: ["text", "structured", "code"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, defaults: { minCount: 1, minConfidence: "medium" }, legacyKind: "secret" }),
    t("CREDENTIAL.CREDENTIAL_FILE", "Credential file (by name)", ["credential file", "credential files", "env file", "env files", "dotenv", ".env", "keyfile", "keyfiles", "key file", "key files", "kubeconfig", "kubeconfig files", "netrc", "htpasswd", "id rsa", "pem", "pem file", "pem files", "p12", "pfx", "keystore"], { inputs: ["metadata", "any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "credential_file" }),
    // ── Source code ──────────────────────────────────────────────────────
    t("SOURCE_CODE", "Source code (any)", ["source code", "source", "code", "sourcecode", "program code", "software code", "scripts", "source files", "codebase"], { inputs: ["text", "code"], transforms: { LIMIT: "supported", REDACT: "supported", DROP_FIELD: "supported" }, legacyKind: "source_code" }),
    t("SOURCE_CODE.SNIPPET", "Code snippet", ["code snippet", "snippet", "code fragment"], { inputs: ["text", "code"], transforms: { LIMIT: "supported", REDACT: "supported" }, legacyKind: "source_code" }),
    t("SOURCE_CODE.PROPRIETARY", "Proprietary source code (provenance)", ["proprietary code", "proprietary source code", "our source code", "company source code", "internal code"], { inputs: ["text", "code"], transforms: { LIMIT: "supported" }, tenantConfig: { required: true, kind: "regex" }, legacyKind: "source_code", status: "declared" }),
    t("SOURCE_CODE.IAC", "Infrastructure as code", ["infrastructure as code", "terraform", "kubernetes manifests", "helm charts", "cloudformation", "iac"], { inputs: ["text", "code"], transforms: { LIMIT: "supported", REDACT: "supported" }, legacyKind: "source_code" }),
    t("SOURCE_CODE.BUILD_CONFIG", "Build and configuration files", ["configuration file", "configuration files", "config file", "config files", "build config", "package manifest"], { inputs: ["text", "structured", "code"], transforms: { LIMIT: "supported", REDACT: "supported" }, legacyKind: "source_code" }),
    // ── HR ───────────────────────────────────────────────────────────────
    t("HR", "HR information (any)", ["hr", "hr data", "hr information", "human resources data", "employee data", "employee information", "employee records", "personnel data", "personnel records", "workforce data"], { transforms: REDACT_ONLY, legacyKind: "employee_data" }),
    t("HR.EMPLOYEE_ID", "Employee identifier", ["employee id", "employee ids", "employee number", "employee numbers", "staff id", "staff number", "personnel number"], { transforms: TOKENIZABLE, tenantConfig: { required: true, kind: "edm_index" }, legacyKind: "employee_data", status: "declared" }),
    t("HR.SALARY", "Compensation", ["salary", "salaries", "compensation", "pay", "payroll", "payroll data", "bonus", "bonuses", "wage", "wages"], { transforms: { ...REDACT_ONLY, GENERALIZE: "supported" }, legacyKind: "employee_data", status: "declared" }),
    t("HR.PERFORMANCE_REVIEW", "Performance reviews", ["performance review", "performance reviews", "performance rating", "appraisal", "appraisals", "employee evaluation"], { transforms: REDACT_ONLY, legacyKind: "employee_data", status: "declared" }),
    t("HR.DISCIPLINARY", "Disciplinary records", ["disciplinary", "disciplinary record", "disciplinary action", "misconduct"], { transforms: REDACT_ONLY, legacyKind: "employee_data", status: "declared" }),
    t("HR.BACKGROUND_CHECK", "Background checks", ["background check", "background checks", "screening results"], { transforms: REDACT_ONLY, legacyKind: "employee_data", status: "declared" }),
    t("HR.TERMINATION", "Termination records", ["termination", "terminations", "severance", "layoff", "layoffs", "redundancy"], { transforms: REDACT_ONLY, legacyKind: "employee_data", status: "declared" }),
    // ── Legal ────────────────────────────────────────────────────────────
    t("LEGAL", "Legal information (any)", ["legal", "legal data", "legal documents", "legal document", "legal information", "legal matters"], { transforms: REDACT_ONLY, legacyKind: "legal" }),
    t("LEGAL.PRIVILEGED", "Privileged communications", ["privileged", "attorney client privilege", "attorney client privileged", "legal privilege", "legally privileged", "privileged communication", "work product"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "legal" }),
    t("LEGAL.CONTRACT", "Contracts and agreements", ["contract", "contracts", "agreement", "agreements", "msa", "sow", "statement of work", "terms of service"], { transforms: REDACT_ONLY, legacyKind: "legal" }),
    t("LEGAL.NDA", "Non-disclosure agreements", ["nda", "ndas", "non disclosure agreement", "confidentiality agreement"], { transforms: REDACT_ONLY, legacyKind: "legal" }),
    t("LEGAL.LITIGATION_HOLD", "Litigation hold material", ["litigation hold", "legal hold", "litigation", "discovery material"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "legal", status: "declared" }),
    t("LEGAL.REGULATORY_FILING", "Regulatory filings", ["regulatory filing", "regulatory filings", "sec filing", "10 k", "10 q"], { transforms: REDACT_ONLY, legacyKind: "legal", status: "declared" }),
    // ── Company IP ───────────────────────────────────────────────────────
    t("COMPANY_IP", "Company intellectual property (any)", ["ip", "intellectual property", "company ip", "proprietary information", "proprietary data", "confidential information", "confidential", "confidential data", "restricted", "internal only", "company confidential"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "confidential" }),
    t("COMPANY_IP.TRADE_SECRET", "Trade secrets", ["trade secret", "trade secrets", "secret formula", "proprietary algorithm", "proprietary process"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "ip", status: "declared" }),
    t("COMPANY_IP.ROADMAP", "Product roadmap", ["roadmap", "roadmaps", "product roadmap", "product plans", "release plan", "unreleased features", "unreleased products"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "ip", status: "declared" }),
    t("COMPANY_IP.M_AND_A", "Mergers and acquisitions material", ["m and a", "m a", "mergers and acquisitions", "merger", "acquisition", "acquisitions", "deal material", "due diligence", "term sheet"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "m_and_a", status: "declared" }),
    t("COMPANY_IP.BOARD_MATERIAL", "Board material", ["board material", "board materials", "board deck", "board pack", "board minutes", "board meeting"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "ip", status: "declared" }),
    t("COMPANY_IP.DESIGN_DOC", "Design documents", ["design doc", "design docs", "design document", "architecture document", "technical design", "rfc"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "ip", status: "declared" }),
    t("COMPANY_IP.CODENAME", "Project codenames", ["codename", "codenames", "project codename", "project codenames", "internal project name"], { transforms: TOKENIZABLE, tenantConfig: { required: true, kind: "dictionary" }, legacyKind: "ip", status: "declared" }),
    t("COMPANY_IP.CONFIDENTIAL_MARKING", "Documents marked confidential", ["marked confidential", "confidential marking", "classified document", "restricted document", "tlp marked"], { transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "confidential" }),
    // ── Customer ─────────────────────────────────────────────────────────
    t("CUSTOMER", "Customer information (any)", ["customer information", "customer records", "customer details", "client data", "client information", "client records"], { transforms: TOKENIZABLE, legacyKind: "pii" }),
    t("CUSTOMER.ID", "Customer identifier", ["customer id", "customer ids", "customer number", "customer numbers", "account id", "client id", "client ids"], { transforms: TOKENIZABLE, tenantConfig: { required: true, kind: "edm_index" }, legacyKind: "pii", status: "declared" }),
    t("CUSTOMER.CONTRACT", "Customer contracts", ["customer contract", "customer contracts", "client contract", "client agreement"], { transforms: REDACT_ONLY, legacyKind: "legal", status: "declared" }),
    t("CUSTOMER.SUPPORT_TICKET", "Support tickets", ["support ticket", "support tickets", "helpdesk ticket", "case notes"], { transforms: TOKENIZABLE, legacyKind: "pii", status: "declared" }),
    t("CUSTOMER.NAME", "Customer / client names", ["client name", "client names", "customer name list", "named clients"], { transforms: TOKENIZABLE, tenantConfig: { required: true, kind: "edm_index" }, legacyKind: "pii", status: "declared" }),
    // ── Geo ──────────────────────────────────────────────────────────────
    t("GEO", "Location data (any)", ["location", "location data", "geolocation", "geo data"], { transforms: { GENERALIZE: "supported", REDACT: "supported" }, legacyKind: "pii", status: "declared" }),
    t("GEO.COORDINATES", "Coordinates", ["coordinates", "gps", "gps coordinates", "lat long", "latitude longitude"], { transforms: { GENERALIZE: "supported", REDACT: "supported" }, legacyKind: "pii", status: "declared" }),
    t("GEO.PRECISE_LOCATION", "Precise location", ["precise location", "exact location", "home location"], { transforms: { GENERALIZE: "supported", REDACT: "supported" }, legacyKind: "pii", status: "declared" }),
    // ── Labels — a label is a finding in its own right ───────────────────
    t("LABEL", "Enterprise sensitivity label (any)", ["label", "labels", "sensitivity label", "sensitivity labels", "classification label", "labelled", "labeled"], { inputs: ["metadata"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: true, kind: "label_map" }, legacyKind: "confidential" }),
    t("LABEL.MIP", "Microsoft Purview / MIP label", ["mip label", "purview label", "microsoft sensitivity label", "aip label"], { inputs: ["metadata"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: true, kind: "label_map" }, legacyKind: "confidential" }),
    t("LABEL.MIP.HIGHLY_CONFIDENTIAL", "MIP: Highly Confidential", ["highly confidential", "highly confidential label"], { inputs: ["metadata"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: true, kind: "label_map" }, legacyKind: "confidential" }),
    t("LABEL.MIP.CONFIDENTIAL", "MIP: Confidential", ["confidential label"], { inputs: ["metadata"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: true, kind: "label_map" }, legacyKind: "confidential" }),
    t("LABEL.MIP.INTERNAL", "MIP: Internal", ["internal label"], { inputs: ["metadata"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: true, kind: "label_map" }, legacyKind: "confidential" }),
    t("LABEL.MIP.PROTECTED", "MIP: RMS-protected (encrypted)", ["rms protected", "irm protected", "encrypted by label"], { inputs: ["metadata"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, legacyKind: "confidential" }),
    t("LABEL.GOOGLE_DRIVE", "Google Drive label", ["drive label", "google drive label"], { inputs: ["metadata"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: true, kind: "label_map" }, legacyKind: "confidential", status: "declared" }),
    // ── Semantic (document category) classes ─────────────────────────────
    t("SEMANTIC", "Semantic document category (any)", ["document category", "document type"], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, locality: "device", legacyKind: "confidential", status: "declared" }),
    t("SEMANTIC.BOARD_MATERIAL", "Board material (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "ip", status: "declared" }),
    t("SEMANTIC.M_AND_A", "M&A material (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "m_and_a", status: "declared" }),
    t("SEMANTIC.LEGAL_PRIVILEGE", "Legal privilege (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "legal", status: "declared" }),
    t("SEMANTIC.PRODUCT_ROADMAP", "Product roadmap (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "ip", status: "declared" }),
    t("SEMANTIC.TRADE_SECRET", "Trade secret (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "ip", status: "declared" }),
    t("SEMANTIC.PERFORMANCE_REVIEW", "Performance review (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "employee_data", status: "declared" }),
    t("SEMANTIC.CLINICAL_DOCUMENT", "Clinical document (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "phi", status: "declared" }),
    t("SEMANTIC.CUSTOMER_CONTRACT", "Customer contract (classifier)", [], { inputs: ["text"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN, tenantConfig: { required: false, kind: "model" }, legacyKind: "legal", status: "declared" }),
    // ── Tenant namespace root ────────────────────────────────────────────
    t("CUSTOM", "Tenant-defined data type (any)", [], { transforms: TOKENIZABLE, tenantConfig: { required: true, kind: "edm_index" }, legacyKind: "custom", status: "declared" }),
    // ── Uninspectable states — evaluable in policy like any other type ───
    t("UNINSPECTABLE", "Content that could not be inspected (any reason)", ["uninspectable", "cannot be inspected", "unreadable content", "opaque content"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.ENCRYPTED", "Encrypted content", ["encrypted", "encrypted file", "encrypted files", "encrypted document"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.PASSWORD_PROTECTED", "Password-protected content", ["password protected", "password protected file"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.UNSUPPORTED_FORMAT", "Unsupported format", ["unsupported format", "unsupported file", "unknown format", "unknown file type"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.OVERSIZE", "Payload over the inspection limit", ["oversize", "too large to inspect"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.DEPTH_EXCEEDED", "Nesting depth exceeded", ["nested too deep"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.PARSER_FAILURE", "Parser failed or crashed", ["parser failure", "parse failure"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.TIMEOUT", "Inspection timed out", ["inspection timeout"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.DECOMPRESSION_REFUSED", "Decompression refused (bomb / corrupt)", ["decompression refused", "zip bomb"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.MALFORMED", "Malformed content", ["malformed", "corrupt file", "corrupted file"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
    t("UNINSPECTABLE.TRANSPORT", "Transport not inspectable (WebSocket, host-only)", ["websocket", "host only"], { inputs: ["any"], transforms: NO_TRANSFORM, actions: NO_CONSTRAIN }),
];
export const UNINSPECTABLE_STATES = [
    "ENCRYPTED", "PASSWORD_PROTECTED", "UNSUPPORTED_FORMAT", "OVERSIZE", "DEPTH_EXCEEDED",
    "PARSER_FAILURE", "TIMEOUT", "DECOMPRESSION_REFUSED", "MALFORMED", "TRANSPORT",
];
export class DataTypeRegistry {
    byId = new Map();
    aliasIndex = new Map();
    version;
    constructor(types = BUILTIN_TYPES, version = "1.0.0") {
        this.version = version;
        for (const d of types)
            this.add(d);
    }
    add(d) {
        if (!/^[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_-]+)*$/.test(d.id))
            throw new Error(`invalid data type id: ${d.id}`);
        this.byId.set(d.id, d);
        this.aliasIndex.set(norm(d.id.replace(/[._]/g, " ")), d.id);
        for (const a of d.aliases)
            if (a && !this.aliasIndex.has(a))
                this.aliasIndex.set(a, d.id);
    }
    /** Register a tenant type. Unconfigured tenant types are `declared`. */
    addCustom(spec) {
        const id = `CUSTOM.${spec.tenant}.${spec.name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_")}`;
        const d = {
            id, parent: "CUSTOM", label: spec.label, aliases: spec.aliases.map(norm),
            inputs: ["text", "table", "structured"],
            transforms: spec.transforms ?? TOKENIZABLE,
            actions: spec.actions ?? ALL_ACTIONS,
            locality: "device",
            tenantConfig: { required: true, kind: spec.detection.kind },
            defaults: spec.defaults ?? { minCount: 1, minConfidence: "high" },
            evidence: STD_EVIDENCE,
            status: spec.configured ? "beta" : "declared",
            legacyKind: "custom",
        };
        this.add(d);
        return d;
    }
    get(id) { return this.byId.get(id); }
    has(id) { return this.byId.has(id); }
    all() { return [...this.byId.values()]; }
    ids() { return [...this.byId.keys()]; }
    /** Ancestors from the type up to its family, inclusive of the type itself. */
    lineage(id) {
        const parts = id.split(".");
        const out = [];
        for (let i = parts.length; i >= 1; i--)
            out.push(parts.slice(0, i).join("."));
        return out;
    }
    /** True when `id` is `prefix` or a descendant of it. */
    isWithin(id, prefix) {
        return id === prefix || id.startsWith(prefix + ".");
    }
    /** Every registered type at or under a prefix. */
    descendants(prefix) {
        return this.all().filter((d) => this.isWithin(d.id, prefix));
    }
    family(id) { return id.split(".")[0]; }
    /**
     * Resolve an administrator's phrase to a registry id. Exact id, exact alias,
     * then the LONGEST alias that appears as a whole-word phrase. Returns null
     * rather than guessing; the caller turns null into a CUSTOM candidate.
     */
    resolve(phrase) {
        const raw = phrase.trim();
        if (!raw)
            return null;
        const upper = raw.toUpperCase().replace(/\s+/g, "_");
        if (this.byId.has(upper))
            return { id: upper, via: "id" };
        const n = norm(raw);
        const exact = this.aliasIndex.get(n);
        if (exact)
            return { id: exact, via: "alias" };
        // Whole-word phrase containment, longest alias wins.
        const words = n.split(" ").map(stem);
        let best = null;
        for (const [alias, id] of this.aliasIndex) {
            const aw = alias.split(" ").map(stem);
            if (aw.length > words.length)
                continue;
            for (let i = 0; i + aw.length <= words.length; i++) {
                if (aw.every((w, j) => words[i + j] === w)) {
                    if (!best || aw.length > best.len)
                        best = { id, len: aw.length };
                    break;
                }
            }
        }
        return best ? { id: best.id, via: "phrase" } : null;
    }
    /**
     * Resolve EVERY type named in a phrase ("customer email addresses and phone
     * numbers" → EMAIL, PHONE). Greedy, longest alias first, non-overlapping,
     * with light plural stemming so "card numbers" meets "card number".
     */
    resolveAll(phrase) {
        const direct = this.resolve(phrase);
        if (direct && (direct.via === "id" || direct.via === "alias"))
            return [{ ...direct, match: phrase.trim() }];
        const words = norm(phrase).split(" ").filter(Boolean);
        const stems = words.map(stem);
        const taken = new Array(words.length).fill(false);
        const hits = [];
        const aliases = [...this.aliasIndex.entries()].map(([a, id]) => ({ a: a.split(" ").map(stem), id })).sort((x, y) => y.a.length - x.a.length);
        for (const { a, id } of aliases) {
            for (let i = 0; i + a.length <= words.length; i++) {
                if (taken.slice(i, i + a.length).some(Boolean))
                    continue;
                if (a.every((w, j) => stems[i + j] === w)) {
                    hits.push({ id, start: i, len: a.length });
                    for (let k = i; k < i + a.length; k++)
                        taken[k] = true;
                }
            }
        }
        hits.sort((x, y) => x.start - y.start);
        const seen = new Set();
        const out = [];
        for (const h of hits) {
            if (seen.has(h.id))
                continue;
            seen.add(h.id);
            out.push({ id: h.id, via: "phrase", match: words.slice(h.start, h.start + h.len).join(" ") });
        }
        return out;
    }
    /** The coarse runtime kind a type reduces to (wire compatibility). */
    legacyKind(id) {
        for (const anc of this.lineage(id)) {
            const d = this.byId.get(anc);
            if (d?.legacyKind)
                return d.legacyKind;
        }
        return null;
    }
    /** Effective policy defaults, inherited down the lineage. */
    defaults(id) {
        for (const anc of this.lineage(id)) {
            const d = this.byId.get(anc);
            if (d)
                return d.defaults;
        }
        return { minCount: 1, minConfidence: "medium" };
    }
    /** Whether a transform is declared supported for a type (inherited). */
    transformSupport(id, transform) {
        for (const anc of this.lineage(id)) {
            const d = this.byId.get(anc);
            const s = d?.transforms[transform];
            if (s)
                return s;
        }
        return "not_applicable";
    }
    /** Decisions a clause may take on this type (inherited). */
    allowedActions(id) {
        for (const anc of this.lineage(id)) {
            const d = this.byId.get(anc);
            if (d)
                return d.actions;
        }
        return ALL_ACTIONS;
    }
    /** Generated alias table — the ONLY alias table the validator may use. */
    aliasTable() {
        return Object.fromEntries(this.aliasIndex);
    }
}
let defaultRegistry = null;
/** The process-wide registry (built-ins + whatever tenant types were added). */
export function dataTypes() {
    if (!defaultRegistry)
        defaultRegistry = new DataTypeRegistry();
    return defaultRegistry;
}
/** Test hook: replace the process-wide registry. */
export function setDataTypeRegistry(r) { defaultRegistry = r; }
