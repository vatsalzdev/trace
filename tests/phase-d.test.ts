import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { analyzeMessage } from '../shared/message';
import type { Coverage } from '../shared/types';
import { analyzeUrl } from '../shared/url';
import { computeVerdict, VERDICT_CONFIG } from '../shared/verdict';
import { inspectApk } from '../server/src/apk';
import { parseDex } from '../server/src/dex';
import { buildApkFixture, type ApkFixtureKind } from '../server/src/sample-apk';
import { assertPublicUrl } from '../server/src/ssrf';

const ROOT = resolve(import.meta.dirname, '..');
const DISCLAIMER = 'No indicators found by TRACE\'s checks. This is not a guarantee of safety.';

function coverage(skipped: Coverage['checksSkipped'] = []): Coverage {
  return { checksRun: ['unit test'], checksSkipped: skipped };
}

test('SSRF guard refuses loopback, private, link-local, CGNAT and non-HTTP schemes', async () => {
  const targets = [
    'http://127.0.0.1/x',
    'http://10.0.0.5/x',
    'http://172.16.4.4/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/x',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'file:///etc/passwd',
    'ftp://example.com/x',
  ];
  for (const url of targets) {
    await assert.rejects(() => assertPublicUrl(url), /refused/i, `expected ${url} to be refused`);
  }
});

test('mixed-script homoglyph host is detected and flagged', () => {
  const analysis = analyzeUrl('https://\u0430pple.com');
  const ids = analysis.heuristics.filter((h) => h.triggered).map((h) => h.id);
  assert.ok(ids.includes('mixed-script'), `mixed-script missing: ${ids.join(',')}`);
  assert.ok(ids.includes('homoglyph-skeleton'), `homoglyph-skeleton missing: ${ids.join(',')}`);
  assert.ok(analysis.verdict.score >= VERDICT_CONFIG.suspiciousScore);
});

test('confusable skeleton matches a protected brand even without the literal brand string', () => {
  const analysis = analyzeUrl('https://g\u043e\u043egle.com');
  const skeleton = analysis.heuristics.find((h) => h.id === 'homoglyph-skeleton');
  assert.ok(skeleton?.triggered, 'skeleton match did not fire');
  assert.ok(skeleton.evidence.some((line) => /google/i.test(line)), `no brand in evidence: ${skeleton.evidence.join(' | ')}`);
});

test('unknown domain offline returns no data instead of invented enrichment', async () => {
  process.env.TRACE_FORCE_OFFLINE = '1';
  const { enrichUrl } = await import('../server/src/enrich');
  const result = await enrichUrl('https://trace-eval-no-data-987654321.com');
  assert.equal(result.enrichment.dataStatus, 'none');
  assert.equal(result.enrichment.registration.createdAt, null);
  assert.deepEqual(result.enrichment.dns.a, []);
  assert.equal(result.enrichment.tls.issuer, '');
  assert.deepEqual(result.enrichment.redirects, []);
  assert.match(result.enrichment.note, /Nothing was invented/i);
  assert.ok(result.verdict.coverage.checksSkipped.some((s) => /enrich|registration|network/i.test(`${s.id} ${s.reason}`)));
});

test('verdict boundaries follow the single config object', () => {
  const finding = (id: string, weight: number, category: string) => ({ id, weight, evidence: [], explanation: id, category });
  const base = { coverage: coverage() };

  assert.equal(computeVerdict({ ...base, score: 34, findings: [finding('a', 34, 'identity')] }).verdict, 'NO_INDICATORS');
  assert.equal(computeVerdict({ ...base, score: 35, findings: [finding('a', 35, 'identity')] }).verdict, 'SUSPICIOUS');
  assert.equal(
    computeVerdict({ ...base, score: 70, findings: [finding('a', 70, 'identity')] }).verdict,
    'SUSPICIOUS',
    '70 with one category must not be MALICIOUS',
  );
  assert.equal(
    computeVerdict({ ...base, score: 70, findings: [finding('a', 40, 'identity'), finding('b', 30, 'network')] }).verdict,
    'MALICIOUS',
  );
  assert.equal(computeVerdict({ ...base, score: 0, findings: [], poorCoverage: true }).verdict, 'INCONCLUSIVE');
  assert.equal(computeVerdict({ ...base, score: 0, findings: [], analysisFailed: true }).verdict, 'INCONCLUSIVE');
  assert.equal(computeVerdict({ ...base, score: 0, findings: [] }).verdict, 'NO_INDICATORS');
});

test('DEX parser survives truncated and malformed input', () => {
  const malformed = parseDex(Buffer.from('not a dex file at all'));
  assert.ok(malformed.error, 'malformed input should report an error');
  assert.equal(malformed.methods.length, 0);

  const header = Buffer.alloc(160);
  Buffer.from('dex\n035\0', 'latin1').copy(header, 0);
  header.writeUInt32LE(160, 0x20);
  header.writeUInt32LE(100000, 0x38);
  header.writeUInt32LE(0xfffffff0, 0x3c);
  header.writeUInt32LE(100000, 0x40);
  header.writeUInt32LE(0xfffffff0, 0x44);
  header.writeUInt32LE(100000, 0x58);
  header.writeUInt32LE(0xfffffff0, 0x5c);
  header.writeUInt32LE(100000, 0x60);
  header.writeUInt32LE(0xfffffff0, 0x64);
  const truncated = parseDex(header);
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.strings.length === 0 || truncated.strings.length < 100000);

  const random = Buffer.concat([Buffer.from('dex\n035\0', 'latin1'), Buffer.alloc(4096, 0x7f)]);
  assert.doesNotThrow(() => parseDex(random));
});

test('nested APK plus install capability is detected as a dropper', async () => {
  const { buffer } = await buildApkFixture('dropper');
  const analysis = await inspectApk(buffer, 'dropper.apk');
  const dropper = analysis.rules.find((r) => r.id === 'dropper');
  assert.ok(dropper?.triggered, `dropper rule did not fire: ${analysis.rules.filter((r) => r.triggered).map((r) => r.id)}`);
  assert.ok(analysis.nestedFiles.some((f) => f.kind === 'apk'), 'nested APK not inventoried');
  assert.equal(analysis.verdict.verdict, 'MALICIOUS');
});

test('packed APK is INCONCLUSIVE, never NO_INDICATORS', async () => {
  const { buffer } = await buildApkFixture('packed-like');
  const analysis = await inspectApk(buffer, 'packed-like.apk');
  assert.equal(analysis.packed, true);
  assert.equal(analysis.verdict.verdict, 'INCONCLUSIVE');
  assert.notEqual(analysis.verdict.verdict, 'NO_INDICATORS');
  assert.ok(analysis.verdict.coverage.checksSkipped.some((s) => s.id === 'packed'));
  assert.equal(analysis.verdict.confidence, 'LOW');
});

test('multi-signal scam rules fire with visible evidence and skip benign controls', () => {
  const cases: Array<[string, string]> = [
    ['digital-arrest', 'CBI officer here. A money laundering case is registered. Stay on the video call and transfer the clearance amount now.'],
    ['prize-fee', 'You won a lucky draw. Pay Rs 990 tax and send your bank details to claim.'],
    ['loan-apk', 'Loan sanctioned. Install the APK within 20 minutes and upload your Aadhaar.'],
    ['delivery-fee', 'Your courier address is incomplete. Pay Rs 29 redelivery fee here http://parcel-redelivery.xyz/update'],
  ];
  for (const [id, text] of cases) {
    const result = analyzeMessage(text);
    const rule = result.rules.find((r) => r.id === id);
    assert.ok(rule?.triggered, `${id} did not fire: ${result.rules.filter((r) => r.triggered).map((r) => r.id).join(',')}`);
    assert.ok((rule?.evidence.length ?? 0) > 0, `${id} has no evidence`);
    assert.ok(result.verdict.score >= VERDICT_CONFIG.suspiciousScore, `${id} scored ${result.verdict.score}`);
  }
  const benign = analyzeMessage('Your parcel is out for delivery today. No payment is needed. Track it in the official app.');
  for (const id of cases.map(([id]) => id)) {
    assert.equal(benign.rules.find((r) => r.id === id)?.triggered, false, `${id} fired on a benign notice`);
  }
});

test('brand/lure/TLD URL finding fires with evidence and skips the official host', () => {
  const result = analyzeUrl('https://axis-secure.xyz/login');
  const brandLure = result.heuristics.find((h) => h.id === 'brand-lure-tld');
  assert.ok(brandLure?.triggered, 'brand-lure-tld did not fire on axis-secure.xyz');
  assert.ok(brandLure.evidence.some((e) => /axis/i.test(e)), `no brand evidence: ${brandLure.evidence.join(' | ')}`);
  assert.ok(brandLure.evidence.some((e) => /secure/i.test(e)), `no lure evidence: ${brandLure.evidence.join(' | ')}`);
  assert.ok(result.verdict.score >= VERDICT_CONFIG.suspiciousScore, `URL scored ${result.verdict.score}`);
  const official = analyzeUrl('https://www.axisbank.com/secure/login');
  assert.equal(official.heuristics.find((h) => h.id === 'brand-lure-tld')?.triggered, false);
});

test('every NO_INDICATORS result carries the exact disclaimer', async () => {
  const url = analyzeUrl('https://www.google.com');
  const message = analyzeMessage('Your OTP is 123456. Do not share it with anyone.');
  const { buffer } = await buildApkFixture('benign');
  const apk = await inspectApk(buffer, 'benign.apk');

  for (const [name, result] of [
    ['url', url],
    ['message', message],
    ['apk', apk],
  ] as const) {
    assert.equal(result.verdict.verdict, 'NO_INDICATORS', `${name} expected NO_INDICATORS, got ${result.verdict.verdict}`);
    assert.equal(result.verdict.disclaimer, DISCLAIMER, `${name} disclaimer mismatch`);
  }
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('rendered UI labels never use safe, clean or verified as a verdict', () => {
  const files = walk(join(ROOT, 'client', 'src'));
  const banned = /\b(?:safe|clean|verified)\b/i;
  const hits: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (banned.test(line)) hits.push(`${file.replace(ROOT, '')}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], `banned verdict wording found:\n${hits.join('\n')}`);
});
