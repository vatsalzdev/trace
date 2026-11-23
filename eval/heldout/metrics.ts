import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeMessage } from '../../shared/message';
import { analyzeUrl } from '../../shared/url';
import type { VerdictResult } from '../../shared/types';

const ROOT = join(import.meta.dirname, '..');

export interface HeldoutResult {
  input: string;
  verdict: VerdictResult;
}

function load(file: string): string[] {
  return JSON.parse(readFileSync(join(ROOT, 'heldout', file), 'utf8')) as string[];
}

export function runHeldout(): { messages: HeldoutResult[]; urls: HeldoutResult[] } {
  return {
    messages: load('messages.json').map((input) => ({ input, verdict: analyzeMessage(input).verdict })),
    urls: load('urls.json').map((input) => ({ input, verdict: analyzeUrl(input).verdict })),
  };
}

function flagged(result: HeldoutResult): boolean {
  return result.verdict.verdict === 'MALICIOUS' || result.verdict.verdict === 'SUSPICIOUS';
}

export function describe(name: string, results: HeldoutResult[]): { row: string; misses: string[]; count: number; total: number } {
  const count = results.filter(flagged).length;
  return {
    count,
    total: results.length,
    row: `| ${name} | ${results.length} | ${count} | ${results.length - count} | ${(count / results.length).toFixed(3)} |`,
    misses: results
      .filter((r) => !flagged(r))
      .map((r) => `- \`${r.input}\` -> ${r.verdict.verdict} (${r.verdict.score}/100) [${r.verdict.findings.map((f) => f.id).join(', ') || 'no findings'}]`),
  };
}
