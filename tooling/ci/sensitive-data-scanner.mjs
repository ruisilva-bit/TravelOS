import { readFile } from "node:fs/promises";
import path from "node:path";

const SUSPICIOUS_ASSIGNMENT_KEYS = new Set([
  "accesskey",
  "accesskeyid",
  "accesstoken",
  "apikey",
  "apitoken",
  "authtoken",
  "clientsecret",
  "credential",
  "credentials",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "secretkey",
  "sessiontoken",
  "token",
]);
const SAFE_REFERENCE_PREFIXES = ["env:", "secret-ref:", "systemd-credential:", "vault:"];
const PROVIDER_SIGNATURES = [
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{12,}[.]eyJ[A-Za-z0-9_-]{12,}[.][A-Za-z0-9_-]{12,}\b/g,
];
const GENERIC_RULES = [
  {
    id: "private-key-header",
    patterns: [/-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE\s+KEY-----/g],
  },
  {
    id: "authorization-bearer",
    patterns: [
      /\b(?:authorization|proxy-authorization)\b\s*[:=]\s*["'`]?Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
      /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g,
    ],
  },
  {
    id: "credential-url-userinfo",
    patterns: [/[a-z][a-z0-9+.-]*:\/\/[^\s/:"'<>]+:[^\s/@"'<>]+@[^\s/"'<>]+/gi],
  },
  {
    id: "credential-url-query",
    patterns: [
      /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*[?&](?:access[_-]?token|api[_-]?key|auth[_-]?token|client[_-]?secret|password|secret|token)=[^\s&#"'<>]{8,}/gi,
    ],
  },
  { id: "provider-token-signature", patterns: PROVIDER_SIGNATURES },
  {
    id: "email-address",
    patterns: [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}\b/gi],
  },
];
export const browserLeakageRules = [
  {
    id: "browser-database-runtime-marker",
    patterns: [
      /(?:DATABASE_URL|postgres(?:ql)?:\/\/|node-pg-migrate|from["']pg["']|from["']kysely["'])/gi,
    ],
  },
  {
    id: "browser-credential-reference-marker",
    patterns: [/(?:systemd-credential:|CredentialReferenceId)/g],
  },
];

const lineAt = (text, index) => text.slice(0, index).split("\n").length;
const normalizedAssignmentKey = (key) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();
const shannonEntropy = (value) => {
  const frequencies = new Map();
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
};
const isSafeReference = (rawValue) => {
  const value = rawValue.trim().replace(/[,;]$/, "").trim();
  return (
    value.length === 0 ||
    SAFE_REFERENCE_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    /^<[-A-Z0-9_]+>$/.test(value) ||
    /^[$][{][^}]+[}]$/.test(value) ||
    /^\[(?:REDACTED|REMOVED)\]$/i.test(value) ||
    /^(?:false|null|true|undefined)$/.test(value)
  );
};
const isAllowlisted = (finding, allowlist) =>
  allowlist.some(
    (entry) =>
      entry.path === finding.file &&
      entry.rule === finding.rule &&
      (entry.line === undefined || entry.line === finding.line),
  );

const collectRegexFindings = (text, file, rules) => {
  const findings = [];
  for (const rule of rules) {
    for (const sourcePattern of rule.patterns) {
      const pattern = new RegExp(sourcePattern.source, sourcePattern.flags);
      for (const match of text.matchAll(pattern)) {
        findings.push({ file, rule: rule.id, line: lineAt(text, match.index ?? 0) });
      }
    }
  }
  return findings;
};

const collectAssignmentFindings = (text, file) => {
  const findings = [];
  const assignments = [];
  const quotedAssignment =
    /(?:^|[\s{,;])(?:const\s+|let\s+|var\s+)?["']?([A-Za-z_][A-Za-z0-9_-]{1,63})["']?\s*[:=]\s*(["'`])([^"'`\r\n]*)\2/gm;
  for (const match of text.matchAll(quotedAssignment)) {
    assignments.push({ key: match[1], value: match[3], index: match.index ?? 0 });
  }
  const unquotedAssignment =
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_-]{1,63})\s*(?::|=)\s*([^\s#][^#\r\n]*)$/gm;
  for (const match of text.matchAll(unquotedAssignment)) {
    assignments.push({ key: match[1], value: match[2], index: match.index ?? 0 });
  }
  for (const assignment of assignments) {
    const value = assignment.value.trim().replace(/[,;]$/, "").trim();
    if (
      !SUSPICIOUS_ASSIGNMENT_KEYS.has(normalizedAssignmentKey(assignment.key)) ||
      value.length < 8 ||
      isSafeReference(value)
    ) {
      continue;
    }
    const line = lineAt(text, assignment.index);
    findings.push({ file, rule: "secret-assignment", line });
    if (value.length >= 20 && shannonEntropy(value) >= 3.5) {
      findings.push({ file, rule: "high-entropy-secret-assignment", line });
    }
  }
  return findings;
};

export const scanSensitiveText = ({ text, file, allowlist = [], additionalRules = [] }) => {
  const candidates = [
    ...collectRegexFindings(text, file, [...GENERIC_RULES, ...additionalRules]),
    ...collectAssignmentFindings(text, file),
  ];
  const deduplicated = [
    ...new Map(
      candidates.map((finding) => [`${finding.file}\0${finding.rule}\0${finding.line}`, finding]),
    ).values(),
  ].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.rule.localeCompare(right.rule),
  );
  const findings = deduplicated.filter((finding) => !isAllowlisted(finding, allowlist));
  return {
    findings,
    allowlistedFindingCount: deduplicated.length - findings.length,
  };
};

export const scanSensitiveFiles = async ({
  root = process.cwd(),
  files,
  allowlist = [],
  additionalRules = [],
}) => {
  const findings = [];
  let allowlistedFindingCount = 0;
  const scannedFiles = [...new Set(files)].sort((left, right) => left.localeCompare(right));
  for (const file of scannedFiles) {
    const text = await readFile(path.join(root, file), "utf8");
    const result = scanSensitiveText({ text, file, allowlist, additionalRules });
    findings.push(...result.findings);
    allowlistedFindingCount += result.allowlistedFindingCount;
  }
  return {
    result: findings.length === 0 ? "PASS" : "FAIL",
    filesScanned: scannedFiles,
    findings,
    allowlistedFindingCount,
  };
};
