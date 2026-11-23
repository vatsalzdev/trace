import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = join(ROOT, 'tests', 'artifacts');
const EVIDENCE_FILE = join(ARTIFACTS, 'api-evidence.log');
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
mkdirSync(ARTIFACTS, { recursive: true });
writeFileSync(EVIDENCE_FILE, '');

let nextPort = 5190;
let main;

function evidence(label, value) {
  const line = `[EVIDENCE] ${label}: ${JSON.stringify(value)}`;
  console.log(line);
  appendFileSync(EVIDENCE_FILE, `${line}\n`);
}

function startServer(label, extraEnv = {}) {
  const port = nextPort++;
  const dbDir = join(tmpdir(), `trace-api-${label}-${process.pid}-${port}`);
  mkdirSync(dbDir, { recursive: true });
  const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, PORT: String(port), TRACE_DB_DIR: dbDir, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = { label, port, dbDir, child, base: `http://127.0.0.1:${port}`, log: '' };
  const capture = (chunk) => {
    const text = String(chunk);
    server.log += text;
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  return server;
}

async function waitReady(server, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.label} exited before ready: ${server.log}`);
    }
    try {
      const res = await fetch(`${server.base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await sleep(150);
  }
  throw new Error(`${server.label} did not become ready: ${server.log}`);
}

async function stopServer(server) {
  if (!server) return;
  writeFileSync(join(ARTIFACTS, `api-server-${server.label}.log`), server.log || '(no output)\n');
  if (server.child.exitCode === null) {
    server.child.kill('SIGTERM');
    await Promise.race([once(server.child, 'exit').catch(() => {}), sleep(3000)]);
    if (server.child.exitCode === null) server.child.kill('SIGKILL');
  }
}

async function call(server, path, { method = 'GET', json, form } = {}) {
  const init = { method, headers: {} };
  if (json !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(json);
  }
  if (form) init.body = form;
  const res = await fetch(`${server.base}${path}`, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body, text };
}

function triggeredIds(analysis) {
  const rules = analysis.rules ?? analysis.heuristics ?? [];
  return rules.filter((r) => r.triggered).map((r) => r.id);
}

function ruleById(analysis, id) {
  const rules = analysis.rules ?? analysis.heuristics ?? [];
  return rules.find((r) => r.id === id);
}

before(async () => {
  main = startServer('main');
  await waitReady(main);
  evidence('isolated API server', { base: main.base, dbDir: main.dbDir });
});

after(async () => {
  await stopServer(main);
});

test('1. Scam SMS scores HIGH with all six required rules', async () => {
  const text =
    'URGENT! Your SBI account will be blocked today.\nComplete KYC immediately:\nhttp://sbi-kyc-verify.example.com\n\nPay verification fee to:\nsupport@fakebank';
  const res = await call(main, '/api/analyze/message', { method: 'POST', json: { text } });
  assert.equal(res.status, 200);
  assert.equal(res.body.analysis.riskLabel, 'HIGH');
  assert.ok(res.body.analysis.score >= 60, `score ${res.body.analysis.score} < 60`);
  for (const id of ['urgency', 'brand', 'domain', 'http', 'payment', 'kyc']) {
    const rule = ruleById(res.body.analysis, id);
    assert.ok(rule, `missing rule ${id}`);
    assert.equal(rule.triggered, true, `rule ${id} not triggered`);
    assert.ok(rule.weight > 0, `rule ${id} has no weight`);
    assert.ok(Array.isArray(rule.evidence) && rule.evidence.length > 0, `rule ${id} has empty evidence`);
    assert.ok(rule.evidence.every((e) => typeof e === 'string' && e.length > 0), `rule ${id} has empty evidence item`);
  }
  evidence('scam SMS', {
    score: res.body.analysis.score,
    risk: res.body.analysis.riskLabel,
    rules: triggeredIds(res.body.analysis),
  });
});

test('2. OTP control message stays LOW and does not trigger brand', async () => {
  const text = '123456 is your OTP for txn of Rs 500. Do not share with anyone. -HDFC Bank';
  const res = await call(main, '/api/analyze/message', { method: 'POST', json: { text } });
  assert.equal(res.status, 200);
  assert.equal(res.body.analysis.riskLabel, 'LOW');
  assert.equal(ruleById(res.body.analysis, 'brand').triggered, false);
  evidence('OTP control', { score: res.body.analysis.score, risk: res.body.analysis.riskLabel, rules: triggeredIds(res.body.analysis) });
});

test('3. Correlated message links to multiple saved cases', async () => {
  const raw =
    'SBI ALERT: Your account will be suspended within 24 hours. Update KYC now: http://sbi-kyc-verify.in/update Pay Rs 10 verification fee to kyc.support@fakebank';
  const saved = await call(main, '/api/analyze/message', { method: 'POST', json: { text: raw, save: true, title: 'QA correlated message' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.analysis.riskLabel, 'HIGH');
  assert.ok(saved.body.caseId);

  const lookup = await call(main, '/api/entities?q=kyc.support%40fakebank');
  assert.equal(lookup.status, 200);
  const entity = lookup.body.entities.find((e) => e.type === 'upi' && e.value === 'kyc.support@fakebank');
  assert.ok(entity, 'UPI entity not indexed');
  const related = await call(main, `/api/entities/${entity.id}/related`);
  assert.equal(related.status, 200);
  assert.ok(related.body.cases.length >= 2, `expected >= 2 related cases, got ${related.body.cases.length}`);
  evidence('correlated UPI', { entityId: entity.id, cases: related.body.cases.length, caseIds: related.body.cases.map((c) => c.id) });
});

test('4. URL engine flags look-alike URL and clears official SBI domain', async () => {
  const bad = await call(main, '/api/analyze/url', { method: 'POST', json: { url: 'http://sbi-secure-login.xyz/verify?acc=1' } });
  assert.equal(bad.status, 200);
  assert.equal(bad.body.analysis.riskLabel, 'HIGH');
  for (const id of ['brand-impersonation', 'hyphens', 'suspicious-tld', 'http', 'suspicious-path', 'typosquat']) {
    const rule = ruleById(bad.body.analysis, id);
    assert.ok(rule, `missing URL heuristic ${id}`);
    assert.equal(rule.triggered, true, `URL heuristic ${id} not triggered`);
    assert.ok(rule.evidence.length > 0, `URL heuristic ${id} has no evidence`);
  }
  const good = await call(main, '/api/analyze/url', { method: 'POST', json: { url: 'https://www.sbi.co.in' } });
  assert.equal(good.status, 200);
  assert.equal(good.body.analysis.riskLabel, 'LOW');
  evidence('URL engine', {
    badScore: bad.body.analysis.score,
    badRules: triggeredIds(bad.body.analysis),
    goodScore: good.body.analysis.score,
    goodRisk: good.body.analysis.riskLabel,
  });
});

test('4b. deep scan refuses loopback, private and metadata targets', async () => {
  const targets = ['http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/x'];
  for (const url of targets) {
    const res = await call(main, '/api/analyze/url', { method: 'POST', json: { url, deepScan: true } });
    assert.equal(res.status, 200, `unexpected status for ${url}`);
    const skip = res.body.analysis.verdict.coverage.checksSkipped.find((s) => s.id === 'deep-scan');
    assert.ok(skip, `missing deep-scan coverage entry for ${url}`);
    assert.match(skip.reason, /refused/i, `deep scan did not refuse ${url}: ${skip.reason}`);
  }
  evidence('SSRF guard', { refused: targets });
});

test('5. Edge cases return clean results or clean errors', async () => {
  const empty = await call(main, '/api/analyze/message', { method: 'POST', json: { text: '' } });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.ok, false);

  const longText = 'URGENT KYC http://sbi-kyc-verify.in '.repeat(280).slice(0, 10_000);
  const long = await call(main, '/api/analyze/message', { method: 'POST', json: { text: longText } });
  assert.equal(long.status, 200);
  assert.equal(long.body.analysis.input.length, 10_000);

  const emoji = await call(main, '/api/analyze/message', { method: 'POST', json: { text: '🚨🚨🚨💸📱🔐' } });
  assert.equal(emoji.status, 200);
  assert.equal(emoji.body.analysis.riskLabel, 'LOW');

  for (const input of ['http://xn--sbi-kyc.com', 'sbi-kyc-verify.in', 'http://185.62.190.44/x', 'http://']) {
    const res = await call(main, '/api/analyze/url', { method: 'POST', json: { url: input } });
    assert.ok([200, 400].includes(res.status), `${input} returned ${res.status}`);
    if (res.status === 400) assert.equal(res.body.ok, false);
  }

  const repeated = `${'http://sbi-kyc-verify.in/x '.repeat(5).trim()}`;
  const saved = await call(main, '/api/analyze/message', { method: 'POST', json: { text: repeated, save: true, title: 'QA repeated URL' } });
  assert.equal(saved.status, 200);
  const caseRes = await call(main, `/api/cases/${saved.body.caseId}`);
  const values = caseRes.body.case.entities.map((e) => `${e.type}:${e.value}`);
  assert.equal(new Set(values).size, values.length, 'saved case has duplicate entity values');
  evidence('edge cases', {
    empty: empty.status,
    long: { status: long.status, chars: long.body.analysis.input.length, risk: long.body.analysis.riskLabel },
    emoji: { status: emoji.status, risk: emoji.body.analysis.riskLabel },
    dedupedEntities: values.length,
  });
});

test('6. Message analysis is deterministic', async () => {
  const text =
    'URGENT! Your SBI account will be blocked today.\nComplete KYC immediately:\nhttp://sbi-kyc-verify.example.com\n\nPay verification fee to:\nsupport@fakebank';
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const res = await call(main, '/api/analyze/message', { method: 'POST', json: { text } });
    assert.equal(res.status, 200);
    runs.push({
      score: res.body.analysis.score,
      rules: (res.body.analysis.rules ?? []).map((r) => `${r.id}:${r.triggered}:${r.weight}:${JSON.stringify(r.evidence)}`),
    });
  }
  assert.deepEqual(runs[0], runs[1]);
  assert.deepEqual(runs[1], runs[2]);
  evidence('determinism', { runs: runs.map((r) => r.score), identical: true });
});

test('7. Sample APK inspects cleanly; malformed APKs return clean errors', async () => {
  const sampleRes = await fetch(`${main.base}/api/sample-apk`);
  assert.equal(sampleRes.status, 200);
  const bytes = Buffer.from(await sampleRes.arrayBuffer());
  const form = new FormData();
  form.append('apk', new Blob([bytes], { type: 'application/vnd.android.package-archive' }), 'sample.apk');
  const res = await call(main, '/api/analyze/apk', { method: 'POST', form });
  assert.equal(res.status, 200);
  const analysis = res.body.analysis;
  assert.equal(analysis.packageName, 'com.sbi.kycupdate');
  assert.ok(analysis.permissions.length >= 5);
  const values = analysis.indicators.map((i) => i.normalized);
  for (const expected of ['sbi-kyc-verify.in', 'kyc.support@fakebank', '185.62.190.44']) {
    assert.ok(values.includes(expected), `missing APK indicator ${expected}`);
  }
  assert.match(analysis.sha256, /^[a-f0-9]{64}$/);

  for (const [label, content] of [
    ['text-as-apk', Buffer.from('this is definitely not a zip archive')],
    ['empty-apk', Buffer.alloc(0)],
  ]) {
    const badForm = new FormData();
    badForm.append('apk', new Blob([content]), `${label}.apk`);
    const bad = await call(main, '/api/analyze/apk', { method: 'POST', form: badForm });
    assert.equal(bad.status, 400, `${label} returned ${bad.status}`);
    assert.equal(bad.body.ok, false);
  }
  const health = await call(main, '/api/health');
  assert.equal(health.status, 200);
  evidence('APK', {
    package: analysis.packageName,
    permissions: analysis.permissions.length,
    sha256: analysis.sha256,
    indicators: ['sbi-kyc-verify.in', 'kyc.support@fakebank', '185.62.190.44'],
    malformed: [400, 400],
  });
});

test('8. Case flow links shared entity, persists status and notes', async () => {
  const message = await call(main, '/api/analyze/message', {
    method: 'POST',
    json: { text: 'SBI KYC fee to kyc.support@fakebank at http://sbi-kyc-verify.in/update', save: true, title: 'QA message case' },
  });
  assert.equal(message.status, 200);
  const apkBytes = Buffer.from(await (await fetch(`${main.base}/api/sample-apk`)).arrayBuffer());
  const form = new FormData();
  form.append('apk', new Blob([apkBytes]), 'sample.apk');
  form.append('save', 'true');
  form.append('title', 'QA APK case');
  const apk = await call(main, '/api/analyze/apk', { method: 'POST', form });
  assert.equal(apk.status, 200);

  const graph = await call(main, '/api/graph');
  assert.equal(graph.status, 200);
  const caseNodes = [message.body.caseId, apk.body.caseId].map((id) => `c:${id}`);
  const bridge = graph.body.nodes.find((n) =>
    n.type !== 'case' && caseNodes.every((caseId) => graph.body.edges.some((e) => e.source === caseId && e.target === n.id)),
  );
  assert.ok(bridge, 'no entity node connects both saved cases');

  const patched = await call(main, `/api/cases/${message.body.caseId}`, {
    method: 'PATCH',
    json: { status: 'investigating', notes: 'QA note persisted across reload' },
  });
  assert.equal(patched.status, 200);
  const reloaded = await call(main, `/api/cases/${message.body.caseId}`);
  assert.equal(reloaded.body.case.status, 'investigating');
  assert.equal(reloaded.body.case.notes, 'QA note persisted across reload');
  evidence('case flow', { caseIds: [message.body.caseId, apk.body.caseId], bridge: { id: bridge.id, value: bridge.label }, status: reloaded.body.case.status });
});

test('9. Report payload contains evidence and a recomputable hash', async () => {
  const text = 'URGENT! SBI KYC http://sbi-kyc-verify.in pay kyc.support@fakebank';
  const saved = await call(main, '/api/analyze/message', { method: 'POST', json: { text, save: true, title: 'QA report case' } });
  assert.equal(saved.status, 200);
  const res = await call(main, `/api/cases/${saved.body.caseId}/report-data`, {
    method: 'POST',
    json: { analyst: 'QA Analyst' },
  });
  assert.equal(res.status, 200);
  const report = res.body.report;
  assert.equal(report.case.raw_input, text);
  assert.ok(report.rules.length > 0);
  assert.ok(report.entities.length > 0);
  assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
  assert.match(report.generatedAtIst, /IST$/);
  assert.match(report.integrityHash, /^[a-f0-9]{64}$/);

  const payloadCore = {
    case: report.case,
    analysis: report.analysis,
    rules: report.rules,
    entities: report.entities,
    correlations: report.correlations,
    timeline: report.timeline,
    notes: report.notes,
  };
  const recomputed = createHash('sha256').update(JSON.stringify(payloadCore)).digest('hex');
  assert.equal(recomputed, report.integrityHash);
  writeFileSync(join(ARTIFACTS, 'report-payload.json'), JSON.stringify(report, null, 2));
  evidence('report', { reportId: report.reportId, rules: report.rules.length, entities: report.entities.length, hashMatches: true });
});

test('10a. TRACE_FORCE_OFFLINE returns cached enrichment immediately', async () => {
  const offline = startServer('offline', { TRACE_FORCE_OFFLINE: '1' });
  try {
    await waitReady(offline);
    const started = Date.now();
    const res = await call(offline, '/api/analyze/url', { method: 'POST', json: { url: 'http://sbi-kyc-verify.in' } });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);
    assert.equal(res.body.analysis.enrichment.mode, 'cached');
    assert.match(res.body.analysis.enrichment.note, /TRACE_FORCE_OFFLINE=1/);
    assert.ok(elapsed < 5000, `offline lookup took ${elapsed}ms`);
    evidence('offline fallback', { elapsedMs: elapsed, mode: res.body.analysis.enrichment.mode, status: res.status });
  } finally {
    await stopServer(offline);
  }
});

test('10b. Unroutable lookup target exercises the four-second timeout', async () => {
  const timeoutServer = startServer('timeout', { TRACE_LOOKUP_HOST: '10.255.255.1' });
  try {
    await waitReady(timeoutServer);
    const started = Date.now();
    const res = await call(timeoutServer, '/api/analyze/url', { method: 'POST', json: { url: 'http://sbi-kyc-verify.in' } });
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);
    assert.equal(res.body.analysis.enrichment.mode, 'cached');
    assert.ok(elapsed >= 3500 && elapsed <= 6500, `timeout budget was ${elapsed}ms, expected ~4000ms`);
    evidence('4s timeout', { elapsedMs: elapsed, mode: res.body.analysis.enrichment.mode, status: res.status, target: '10.255.255.1' });
  } finally {
    await stopServer(timeoutServer);
  }
});
