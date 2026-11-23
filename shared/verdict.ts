import type { Confidence, Coverage, Rule, Verdict, VerdictFinding, VerdictResult } from './types';

/** One config object. Thresholds live here and nowhere else. */
export const VERDICT_CONFIG = {
  maliciousScore: 70,
  maliciousMinCategories: 2,
  suspiciousScore: 35,
  disclaimer: "No indicators found by TRACE's checks. This is not a guarantee of safety.",
} as const;

export interface VerdictInput {
  score: number;
  findings: Array<Pick<VerdictFinding, 'id' | 'weight' | 'evidence' | 'explanation' | 'category'> & { triggered?: boolean }>;
  coverage: Coverage;
  /** Analysis failed, APK is packed/obfuscated, or every network check was skipped. */
  poorCoverage?: boolean;
  /** Hard failure (unreadable input, missing manifest). Forces INCONCLUSIVE. */
  analysisFailed?: boolean;
}

/**
 * The single pure verdict function shared by messages, URLs and APKs.
 * Order matters: MALICIOUS, then SUSPICIOUS, then INCONCLUSIVE, then NO_INDICATORS.
 */
export function computeVerdict(input: VerdictInput): VerdictResult {
  const findings: VerdictFinding[] = input.findings
    .filter((f) => f.triggered !== false && f.weight > 0)
    .map((f) => ({
      id: f.id,
      weight: f.weight,
      evidence: f.evidence ?? [],
      explanation: f.explanation,
      category: f.category,
    }));

  const categories = [...new Set(findings.map((f) => f.category).filter((c): c is string => Boolean(c)))];
  const score = Math.max(0, Math.min(100, Math.round(input.score)));
  const poorCoverage = Boolean(input.poorCoverage || input.analysisFailed);

  let verdict: Verdict;
  if (input.analysisFailed) {
    verdict = 'INCONCLUSIVE';
  } else if (score >= VERDICT_CONFIG.maliciousScore && categories.length >= VERDICT_CONFIG.maliciousMinCategories) {
    verdict = 'MALICIOUS';
  } else if (score >= VERDICT_CONFIG.suspiciousScore) {
    verdict = 'SUSPICIOUS';
  } else if (poorCoverage) {
    verdict = 'INCONCLUSIVE';
  } else {
    verdict = 'NO_INDICATORS';
  }

  const confidence: Confidence = poorCoverage
    ? 'LOW'
    : verdict === 'MALICIOUS'
      ? 'HIGH'
      : verdict === 'SUSPICIOUS'
        ? 'MEDIUM'
        : 'MEDIUM';

  return {
    verdict,
    score,
    confidence,
    findings,
    coverage: input.coverage,
    categories,
    ...(verdict === 'NO_INDICATORS' ? { disclaimer: VERDICT_CONFIG.disclaimer } : {}),
  };
}

/** Convenience adapter: existing Rule[] -> verdict findings. */
export function rulesToFindings(rules: Rule[]): VerdictInput['findings'] {
  return rules.map((r) => ({
    id: r.id,
    weight: r.weight,
    evidence: r.evidence,
    explanation: r.explanation,
    category: r.category,
    triggered: r.triggered,
  }));
}
