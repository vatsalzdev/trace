import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeMessage } from '../shared/message';
import { analyzeUrl } from '../shared/url';
import { inspectApk } from '../server/src/apk';
import { buildApkFixture, type ApkFixtureKind } from '../server/src/sample-apk';
import { describe, runHeldout } from './heldout/metrics';

interface Metrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

interface CaseResult {
  input: string;
  expected: 'benign' | 'malicious';
  verdict: string;
  score: number;
  flagged: boolean;
}

const ROOT = join(import.meta.dirname, '..');

function ratio(part: number, total: number): string {
  return total === 0 ? 'n/a' : (part / total).toFixed(3);
}

function metricsOf(results: CaseResult[]): Metrics {
  return {
    tp: results.filter((r) => r.expected === 'malicious' && r.flagged).length,
    fp: results.filter((r) => r.expected === 'benign' && r.flagged).length,
    tn: results.filter((r) => r.expected === 'benign' && !r.flagged).length,
    fn: results.filter((r) => r.expected === 'malicious' && !r.flagged).length,
  };
}

function line(name: string, m: Metrics): string {
  const precision = ratio(m.tp, m.tp + m.fp);
  const recall = ratio(m.tp, m.tp + m.fn);
  return `| ${name} | ${m.tp} | ${m.fp} | ${m.tn} | ${m.fn} | ${precision} | ${recall} |`;
}

function failures(results: CaseResult[], kind: 'fp' | 'fn'): string[] {
  return results
    .filter((r) => (kind === 'fp' ? r.expected === 'benign' && r.flagged : r.expected === 'malicious' && !r.flagged))
    .map((r) => `- \`${r.input.replace(/`/g, "'")}\` -> ${r.verdict} (${r.score}/100)`);
}

function evaluateUrl(): CaseResult[] {
  const data = JSON.parse(readFileSync(join(ROOT, 'eval', 'urls.json'), 'utf8')) as { benign: string[]; malicious: string[] };
  const results: CaseResult[] = [];
  for (const input of data.benign) {
    const analysis = analyzeUrl(input);
    results.push({ input, expected: 'benign', verdict: analysis.verdict.verdict, score: analysis.verdict.score, flagged: analysis.verdict.verdict === 'MALICIOUS' || analysis.verdict.verdict === 'SUSPICIOUS' });
  }
  for (const input of data.malicious) {
    const analysis = analyzeUrl(input);
    results.push({ input, expected: 'malicious', verdict: analysis.verdict.verdict, score: analysis.verdict.score, flagged: analysis.verdict.verdict === 'MALICIOUS' || analysis.verdict.verdict === 'SUSPICIOUS' });
  }
  return results;
}

function evaluateMessages(): CaseResult[] {
  const data = JSON.parse(readFileSync(join(ROOT, 'eval', 'messages.json'), 'utf8')) as { benign: string[]; scam: string[] };
  const results: CaseResult[] = [];
  for (const input of data.benign) {
    const analysis = analyzeMessage(input);
    results.push({ input, expected: 'benign', verdict: analysis.verdict.verdict, score: analysis.verdict.score, flagged: analysis.verdict.verdict === 'MALICIOUS' || analysis.verdict.verdict === 'SUSPICIOUS' });
  }
  for (const input of data.scam) {
    const analysis = analyzeMessage(input);
    results.push({ input, expected: 'malicious', verdict: analysis.verdict.verdict, score: analysis.verdict.score, flagged: analysis.verdict.verdict === 'MALICIOUS' || analysis.verdict.verdict === 'SUSPICIOUS' });
  }
  return results;
}

const POSITIVE_APKS: ApkFixtureKind[] = ['sms-reader', 'overlay-only', 'banker-triad', 'dropper', 'packed-like', 'impersonator'];

async function evaluateApks(): Promise<{ results: CaseResult[]; debugSigned: CaseResult }> {
  const results: CaseResult[] = [];
  for (const kind of ['benign'] as ApkFixtureKind[]) {
    const { buffer } = await buildApkFixture(kind);
    const analysis = await inspectApk(buffer, `${kind}.apk`);
    results.push({ input: kind, expected: 'benign', verdict: analysis.verdict.verdict, score: analysis.verdict.score, flagged: analysis.verdict.verdict !== 'NO_INDICATORS' });
  }
  for (const kind of POSITIVE_APKS) {
    const { buffer } = await buildApkFixture(kind);
    const analysis = await inspectApk(buffer, `${kind}.apk`);
    results.push({ input: kind, expected: 'malicious', verdict: analysis.verdict.verdict, score: analysis.verdict.score, flagged: analysis.verdict.verdict !== 'NO_INDICATORS' });
  }
  const debug = await buildApkFixture('debug-signed');
  const debugAnalysis = await inspectApk(debug.buffer, 'debug-signed.apk');
  return {
    results,
    debugSigned: { input: 'debug-signed', expected: 'malicious', verdict: debugAnalysis.verdict.verdict, score: debugAnalysis.verdict.score, flagged: debugAnalysis.verdict.verdict !== 'NO_INDICATORS' },
  };
}

async function main() {
  const url = evaluateUrl();
  const message = evaluateMessages();
  const apk = await evaluateApks();
  const urlMetrics = metricsOf(url);
  const messageMetrics = metricsOf(message);
  const apkMetrics = metricsOf(apk.results);
  const heldout = runHeldout();
  const heldMessages = describe('Held-out messages', heldout.messages);
  const heldUrls = describe('Held-out URLs', heldout.urls);

  const rows = [
    line('URL engine (static)', urlMetrics),
    line('Message engine', messageMetrics),
    line('APK engine (synthetic)', apkMetrics),
  ];

  const report = [
    '# TRACE evaluation report',
    '',
    `Generated ${new Date().toISOString()} by \`npm run eval\`.`,
    '',
    'These sets are small and partly synthetic. The numbers below describe this harness, not real-world accuracy.',
    '',
    '## Summary',
    '',
    '| Engine | TP | FP | TN | FN | Precision | Recall |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `- URLs: ${url.filter((r) => r.expected === 'benign').length} benign, ${url.filter((r) => r.expected === 'malicious').length} malicious (malicious set generated from templates, marked synthetic).`,
    `- Messages: ${message.filter((r) => r.expected === 'benign').length} benign, ${message.filter((r) => r.expected === 'malicious').length} scam (all scam families, including Hinglish).`,
    `- APKs: ${apk.results.filter((r) => r.expected === 'benign').length} benign, ${apk.results.filter((r) => r.expected === 'malicious').length} malicious-style, all synthetic fixtures from \`server/src/sample-apk.ts\`.`,
    '',
    '## URL failures',
    '',
    '### False positives (benign flagged)',
    ...(failures(url, 'fp').length ? failures(url, 'fp') : ['- none']),
    '',
    '### False negatives (malicious missed)',
    ...(failures(url, 'fn').length ? failures(url, 'fn') : ['- none']),
    '',
    '## Message failures',
    '',
    '### False positives (benign flagged)',
    ...(failures(message, 'fp').length ? failures(message, 'fp') : ['- none']),
    '',
    '### False negatives (scam missed)',
    ...(failures(message, 'fn').length ? failures(message, 'fn') : ['- none']),
    '',
    '## APK results',
    '',
    '| Fixture | Expected | Verdict | Score |',
    '| --- | --- | --- | ---: |',
    ...apk.results.map((r) => `| ${r.input} | ${r.expected} | ${r.verdict} | ${r.score} |`),
    `| debug-signed | weak signal | ${apk.debugSigned.verdict} | ${apk.debugSigned.score} |`,
    '',
    '`debug-signed` is reported separately. A debug signature is a provenance weakness, not enough on its own to cross the SUSPICIOUS threshold; treating it as benign would hide a real risk, and treating it as malicious would overstate the evidence.',
    '',
    '## Interpretation',
    '',
    '- A benign case is a false positive only when the verdict is MALICIOUS or SUSPICIOUS. INCONCLUSIVE is counted as not flagged, because it says the checks could not see enough, not that the target is hostile.',
    '- The malicious URL set is template-generated from typosquats, homoglyphs, IP hosts, embedded-domain tricks, shorteners and keyword-stuffed hosts. It is not a sample of live phishing.',
    '- The message set is hand-written from known Indian scam scripts, including Hinglish. It is not a random sample of real traffic.',
    '- APK fixtures are synthetic ZIPs built by the generator. No real malware was downloaded or executed.',
    '- Verdict thresholds were not changed. Two input-pattern gaps found by the first run were fixed before this report: comma-grouped amounts (`Rs 8,000`) in the family-money rule, and code-forward requests (`forward the code`) in the credential rule. Remaining failures are left in the lists above.',
    '- This recall pass added combination rules and visible brand/lure/TLD evidence, not new thresholds. The held-out set was written and scored before those changes.',
    '- Cause of the missed `axis-secure.xyz` family: `data/brands.json` listed Axis Bank only as "axis bank" and "axisbank", so a bare "axis" label produced no brand or typosquat finding; the URL scored only high-abuse TLD (15) plus path word (10) = 25. "axis" was added to the brand keywords, and a `brand-lure-tld` finding (25) now records the brand, lure word and TLD as visible evidence.',
    '- Cause of the missed keyword-stuffed hosts: `.online` and `.site` were absent from the high-abuse TLD set, so hosts such as `update-your-kyc-now.online` had no TLD signal. Both were added, and a `lure-word-tld` finding (15) records stacked lure words plus the TLD. Shorteners, thin job lures and demand-free threats remain below threshold by design.',
    '',
    '## Main-set change from this recall pass',
    '',
    '| Engine | Before: TP/FN (recall) | After: TP/FN (recall) |',
    '| --- | ---: | ---: |',
    `| URL engine (static) | 56/6 (0.903) | ${urlMetrics.tp}/${urlMetrics.fn} (${ratio(urlMetrics.tp, urlMetrics.tp + urlMetrics.fn)}) |`,
    `| Message engine | 21/9 (0.700) | ${messageMetrics.tp}/${messageMetrics.fn} (${ratio(messageMetrics.tp, messageMetrics.tp + messageMetrics.fn)}) |`,
    `| APK engine (synthetic) | 6/0 (1.000) | ${apkMetrics.tp}/${apkMetrics.fn} (${ratio(apkMetrics.tp, apkMetrics.tp + apkMetrics.fn)}) |`,
    '',
    '## Held-out set',
    '',
    '25 new cases in `eval/heldout/` (15 messages, 10 URLs) were written and scored before any rule or data change; baseline detail is in `eval/heldout/BASELINE.md`. They are hand-built around the scam mechanics under test, not sampled from real traffic, so a high score here does not measure real-world accuracy.',
    '',
    '| Set | Before: flagged/total | Before recall | After: flagged/total | After recall |',
    '| --- | ---: | ---: | ---: | ---: |',
    `| Held-out messages | 4/15 | 0.267 | ${heldMessages.count}/${heldMessages.total} | ${(heldMessages.count / heldMessages.total).toFixed(3)} |`,
    `| Held-out URLs | 9/10 | 0.900 | ${heldUrls.count}/${heldUrls.total} | ${(heldUrls.count / heldUrls.total).toFixed(3)} |`,
    '',
    '### Held-out false negatives',
    ...(heldMessages.misses.length || heldUrls.misses.length
      ? [...heldMessages.misses, ...heldUrls.misses]
      : ['- none']),
    '',
    'The held-out set contains no benign labels, so its false-positive count is always 0; the main sets above are the false-positive check.',
    '',
  ].join('\n');

  writeFileSync(join(ROOT, 'EVAL_REPORT.md'), report, 'utf8');
  console.log(rows.join('\n'));
  console.log(`\nWrote EVAL_REPORT.md`);
  const failed = urlMetrics.fp + urlMetrics.fn + messageMetrics.fp + messageMetrics.fn + apkMetrics.fp + apkMetrics.fn;
  if (failed > 0) console.log(`${failed} labelled case(s) failed; see EVAL_REPORT.md.`);
}

main();
