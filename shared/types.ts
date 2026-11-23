export type RiskLabel = 'LOW' | 'MEDIUM' | 'HIGH';

/** Product-wide verdict vocabulary. Never replace with "safe", "clean" or "verified". */
export type Verdict = 'MALICIOUS' | 'SUSPICIOUS' | 'NO_INDICATORS' | 'INCONCLUSIVE';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CoverageCheck {
  id: string;
  reason: string;
}

export interface Coverage {
  checksRun: string[];
  checksSkipped: CoverageCheck[];
}

export interface VerdictFinding {
  id: string;
  weight: number;
  evidence: string[];
  explanation: string;
  category?: string;
}

export interface VerdictResult {
  verdict: Verdict;
  score: number;
  confidence: Confidence;
  findings: VerdictFinding[];
  coverage: Coverage;
  categories: string[];
  /** Present only for NO_INDICATORS. Must be rendered verbatim wherever the verdict appears. */
  disclaimer?: string;
}

export type ScamType =
  | 'family-impersonation'
  | 'job-scam'
  | 'accidental-code'
  | 'utility-threat'
  | 'kyc-bank'
  | 'delivery-prize'
  | 'digital-arrest'
  | 'apk-loan'
  | 'unknown';
export type EntityType =
  | 'domain'
  | 'url'
  | 'phone'
  | 'upi'
  | 'email'
  | 'package'
  | 'apk_hash'
  | 'ip'
  | 'wallet'
  | 'ifsc'
  | 'account';

export interface Span {
  value: string;
  start: number;
  end: number;
}

export interface ExtractedEntity extends Span {
  type: EntityType;
  normalized: string;
  note?: string;
  suspicious?: boolean;
}

export interface Rule {
  id: string;
  name: string;
  weight: number;
  triggered: boolean;
  evidence: string[];
  explanation: string;
  category?: string;
}

export interface UrlHeuristic extends Rule {
  category: string;
}

export interface UrlBreakdown {
  protocol: string;
  host: string;
  subdomain: string;
  domain: string;
  tld: string;
  port: string;
  path: string;
  query: string;
}

export interface UrlAnalysis {
  input: string;
  normalized: string;
  score: number;
  riskLabel: RiskLabel;
  heuristics: UrlHeuristic[];
  breakdown: UrlBreakdown;
  registrableDomain: string;
  brandMatch?: string;
  isShortener: boolean;
  isIp: boolean;
  verdict: VerdictResult;
}

export interface RedirectHop {
  url: string;
  status: number;
  location?: string;
}

export interface RegistrationInfo {
  registrar: string;
  createdAt: string | null;
  ageDays: number | null;
  status: string[];
  nameservers: string[];
}

export interface DnsInfo {
  a: string[];
  mx: string[];
  ns: string[];
}

export interface TlsInfo {
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
}

export interface Enrichment {
  mode: 'live' | 'cached';
  /** Honest provenance of the enrichment fields. */
  dataStatus: 'live' | 'fixture' | 'none';
  redirects: RedirectHop[];
  registration: RegistrationInfo;
  dns: DnsInfo;
  tls: TlsInfo;
  note?: string;
}

export interface MessageAnalysis {
  input: string;
  score: number;
  riskLabel: RiskLabel;
  rules: Rule[];
  entities: ExtractedEntity[];
  keywords: { category: string; matches: string[] }[];
  urls: { span: Span; analysis: UrlAnalysis }[];
  summary: string;
  scamType: ScamType;
  safetyAdvice: string;
  verdict: VerdictResult;
}

export interface ApkPermission {
  name: string;
  short: string;
  dangerous: boolean;
  weight: number;
  reason: string;
}

export interface ApkComponent {
  type: 'activity' | 'service' | 'receiver' | 'provider';
  name: string;
  exported: boolean;
  intentFilters: string[];
}

export interface ApkIndicator extends Span {
  type: EntityType;
  normalized: string;
  source: string;
}

export interface ApkAnalysis {
  fileName: string;
  fileSize: number;
  sha256: string;
  md5: string;
  packageName: string;
  versionName: string;
  versionCode: string;
  minSdk: string;
  targetSdk: string;
  appLabel: string;
  permissions: ApkPermission[];
  components: ApkComponent[];
  indicators: ApkIndicator[];
  rules: Rule[];
  score: number;
  riskLabel: RiskLabel;
  hashes: { sha256: string; md5: string };
  certificate: { present: boolean; files: string[]; subject?: string; debugSigned: boolean };
  manifestFormat: 'axml' | 'xml';
  summary: string;
}

export interface EntityRecord {
  id: number;
  type: EntityType;
  value: string;
  first_seen: string;
  last_seen: string;
  risk_score: number;
  metadata_json: string;
  case_count?: number;
}

export interface CaseRecord {
  id: string;
  title: string;
  status: 'open' | 'investigating' | 'closed';
  risk_label: RiskLabel;
  risk_score: number;
  source_type: 'message' | 'url' | 'apk' | 'manual';
  raw_input: string;
  created_at: string;
  updated_at: string;
  notes: string;
  entity_count?: number;
  entities?: EntityRecord[];
}

export interface EventRecord {
  id: number;
  case_id: string;
  type: string;
  message: string;
  created_at: string;
}

export interface ReportPayload {
  reportId: string;
  case: CaseRecord;
  generatedAt: string;
  generatedAtIst: string;
  analyst: string;
  analysis: unknown;
  rules: { id: string; name: string; weight: number; evidence: string[]; explanation: string }[];
  entities: { type: string; value: string; cases: number; risk: number }[];
  correlations: { value: string; type: string; cases: string[] }[];
  timeline: EventRecord[];
  notes: string;
  methodology: string;
  integrityHash: string;
}
