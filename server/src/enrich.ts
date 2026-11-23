import { promises as dns } from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import type { CoverageCheck, DnsInfo, Enrichment, RedirectHop, RegistrationInfo, TlsInfo, UrlAnalysis, UrlHeuristic } from '../../shared/types';
import { analyzeUrl, riskFromScore } from '../../shared/url';
import { computeVerdict } from '../../shared/verdict';
import { deepScan } from './deep-scan';
import { dnsFixture, hasFixture, redirectFixture, registrationFixture, tlsFixture } from './fixtures';
import { reputationLookup } from './reputation';
import { assertPublicUrl } from './ssrf';

const TIMEOUT = 4000;
const FORCE_OFFLINE = process.env.TRACE_FORCE_OFFLINE === '1';
const DEEP_SCAN_ENABLED = process.env.TRACE_ENABLE_DEEP_SCAN === '1' || process.env.NODE_ENV !== 'production';
const LOOKUP_HOST = process.env.TRACE_LOOKUP_HOST?.trim() ?? '';
const cache = new Map<string, { value: Enrichment; at: number }>();
const CACHE_TTL = 10 * 60 * 1000;

/**
 * QA hook: exercise the real four-second lookup budget against an unroutable
 * target. The socket is allowed to fail early, but resolution is deliberately
 * held for the configured budget so the timeout path is observable.
 */
function forcedLookupBudget(host: string): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const socket = net.connect({ host, port: 443 });
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve();
    };
    timer = setTimeout(finish, TIMEOUT);
    socket.setTimeout(TIMEOUT, finish);
    socket.once('connect', finish);
    socket.once('error', () => {
      /* Wait for the configured budget so the timeout is deterministic. */
    });
  });
}

function timeout<T>(promise: Promise<T>, ms = TIMEOUT): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isReserved(domain: string): boolean {
  return (
    domain === 'example.com' ||
    domain.endsWith('.example.com') ||
    /\.(example|test|invalid|localhost)$/.test(domain) ||
    domain === 'localhost'
  );
}

async function fetchJson(url: string): Promise<{ data: unknown; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'application/rdap+json, application/json', 'user-agent': 'TRACE-Investigation/1.0' },
    });
    if (!res.ok) throw new Error(`rdap ${res.status}`);
    return { data: await res.json(), status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

async function rdap(domain: string): Promise<RegistrationInfo | null> {
  if (FORCE_OFFLINE || isReserved(domain)) return null;
  if (LOOKUP_HOST) {
    await forcedLookupBudget(LOOKUP_HOST);
    return null;
  }
  try {
    const { data } = await fetchJson(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    const d = data as Record<string, any>;
    const events = Array.isArray(d.events) ? d.events : [];
    const reg = events.find((e: any) => e.eventAction === 'registration');
    const created = reg?.eventDate ?? null;
    const ageDays = created ? Math.max(0, Math.floor((Date.now() - new Date(created).getTime()) / 86400000)) : null;
    let registrar = 'Unknown registrar';
    const entities = Array.isArray(d.entities) ? d.entities : [];
    for (const ent of entities) {
      if (Array.isArray(ent.roles) && ent.roles.includes('registrar')) {
        const vcard = Array.isArray(ent.vcardArray) ? ent.vcardArray[1] : null;
        const fn = Array.isArray(vcard) ? vcard.find((row: any) => Array.isArray(row) && row[0] === 'fn') : null;
        if (fn && fn[3]) registrar = String(fn[3]);
        break;
      }
    }
    return {
      registrar,
      createdAt: created,
      ageDays,
      status: Array.isArray(d.status) ? d.status.map(String) : [],
      nameservers: Array.isArray(d.nameservers) ? d.nameservers.map((n: any) => String(n.ldhName ?? '')).filter(Boolean) : [],
    };
  } catch {
    return null;
  }
}

async function resolveDns(domain: string): Promise<DnsInfo | null> {
  if (FORCE_OFFLINE) return null;
  try {
    const [a, mx, ns] = await Promise.allSettled([
      timeout(dns.resolve4(domain), 3000),
      timeout(dns.resolveMx(domain), 3000),
      timeout(dns.resolveNs(domain), 3000),
    ]);
    const aRec = a.status === 'fulfilled' ? a.value : [];
    const mxRec = mx.status === 'fulfilled' ? mx.value.map((m) => `${m.priority} ${m.exchange}`) : [];
    const nsRec = ns.status === 'fulfilled' ? ns.value : [];
    if (!aRec.length && !mxRec.length && !nsRec.length) return null;
    return { a: aRec, mx: mxRec, ns: nsRec };
  } catch {
    return null;
  }
}

async function tlsCert(host: string): Promise<TlsInfo | null> {
  if (FORCE_OFFLINE) return null;
  if (LOOKUP_HOST) {
    await forcedLookupBudget(LOOKUP_HOST);
    return null;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({ host, port: 443, servername: host, timeout: TIMEOUT, rejectUnauthorized: false });
    const finish = (value: TlsInfo | null) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* noop */
      }
      resolve(value);
    };
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.subject) return finish(null);
      const issuer = (cert.issuer?.CN || cert.issuer?.O || 'Unknown issuer') as string;
      const subject = (cert.subject?.CN || host) as string;
      finish({
        issuer,
        subject,
        validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : '',
        validTo: cert.valid_to ? new Date(cert.valid_to).toISOString() : '',
      });
    });
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

async function followRedirects(start: string): Promise<{ hops: RedirectHop[]; live: boolean }> {
  if (FORCE_OFFLINE) return { hops: [], live: false };
  const hops: RedirectHop[] = [];
  let current = start;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    for (let i = 0; i < 5; i++) {
      try {
        await timeout(assertPublicUrl(current), 3000);
      } catch {
        return { hops: [], live: false };
      }
      const res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; TRACE-Investigation/1.0)', accept: 'text/html,*/*' },
      });
      const location = res.headers.get('location') ?? undefined;
      hops.push({ url: current, status: res.status, location });
      try {
        await res.body?.cancel();
      } catch {
        /* noop */
      }
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).href;
        continue;
      }
      break;
    }
    return { hops, live: hops.length > 0 };
  } catch {
    return { hops: [], live: false };
  } finally {
    clearTimeout(timer);
  }
}

function emptyRegistration(): RegistrationInfo {
  return { registrar: '', createdAt: null, ageDays: null, status: [], nameservers: [] };
}

function emptyDns(): DnsInfo {
  return { a: [], mx: [], ns: [] };
}

function emptyTls(): TlsInfo {
  return { issuer: '', subject: '', validFrom: '', validTo: '' };
}

export function applyEnrichment(analysis: UrlAnalysis, enrichment: Enrichment): UrlAnalysis & { enrichment: Enrichment } {
  const age = enrichment.registration.ageDays;
  const heuristics: UrlHeuristic[] = [...analysis.heuristics];
  if (age !== null) {
    const triggered = age < 180;
    heuristics.push({
      id: 'domain-age',
      name: 'Recently registered domain',
      weight: age < 30 ? 20 : 10,
      triggered,
      evidence: triggered
        ? [
            `registered ${age} day${age === 1 ? '' : 's'} ago`,
            enrichment.registration.createdAt ? `creation date ${enrichment.registration.createdAt.slice(0, 10)}` : '',
            `registrar: ${enrichment.registration.registrar}`,
          ].filter(Boolean)
        : [`registered ${age} days ago`, `registrar: ${enrichment.registration.registrar}`],
      explanation: 'Fraud infrastructure is usually deployed within days of domain registration. Domains under 30 days old carry the highest weight.',
      category: 'infrastructure',
    });
  }
  const score = Math.min(100, heuristics.reduce((sum, h) => sum + (h.triggered ? h.weight : 0), 0));

  const networkSkipped =
    enrichment.dataStatus === 'none'
      ? [
          { id: 'registration', reason: 'No RDAP registration data is available for this domain.' },
          { id: 'dns', reason: 'No DNS records were returned for this domain.' },
          { id: 'tls', reason: 'No TLS certificate data is available for this domain.' },
          { id: 'redirects', reason: 'The redirect chain was not resolved.' },
        ]
      : enrichment.dataStatus === 'fixture'
        ? [{ id: 'live-network', reason: 'Demo fixture data is shown; no live RDAP/DNS/TLS lookup was made.' }]
        : [];
  const baseSkipped = analysis.verdict.coverage.checksSkipped.filter(
    (check) => !['domain-age', 'dns-tls', 'registration', 'dns', 'tls', 'redirects', 'live-network'].includes(check.id),
  );
  const coverage = {
    checksRun: [
      ...analysis.verdict.coverage.checksRun,
      ...(enrichment.dataStatus !== 'none' ? ['registration / DNS / TLS / redirect enrichment'] : []),
    ],
    checksSkipped: [...baseSkipped, ...networkSkipped],
  };
  const verdict = computeVerdict({
    score,
    findings: heuristics.map((h) => ({
      id: h.id,
      weight: h.weight,
      evidence: h.evidence,
      explanation: h.explanation,
      category: h.category,
      triggered: h.triggered,
    })),
    coverage,
    poorCoverage: enrichment.dataStatus === 'none',
  });

  return { ...analysis, heuristics, score, riskLabel: riskFromScore(score), enrichment, verdict };
}

/** Merge deep-scan and reputation findings into an already-enriched result. */
function applyExtras(
  result: UrlAnalysis & { enrichment: Enrichment },
  extras: { heuristics: UrlHeuristic[]; checksRun: string[]; checksSkipped: CoverageCheck[]; poorCoverage?: boolean; note?: string },
): UrlAnalysis & { enrichment: Enrichment } {
  if (!extras.heuristics.length && !extras.checksSkipped.length && !extras.checksRun.length) return result;
  const heuristics = [...result.heuristics, ...extras.heuristics];
  const score = Math.min(100, heuristics.reduce((sum, h) => sum + (h.triggered ? h.weight : 0), 0));
  const coverage = {
    checksRun: [...new Set([...result.verdict.coverage.checksRun, ...extras.checksRun])],
    checksSkipped: [
      ...result.verdict.coverage.checksSkipped.filter((check) => !extras.checksSkipped.some((extra) => extra.id === check.id)),
      ...extras.checksSkipped,
    ],
  };
  const verdict = computeVerdict({
    score,
    findings: heuristics.map((h) => ({
      id: h.id,
      weight: h.weight,
      evidence: h.evidence,
      explanation: h.explanation,
      category: h.category,
      triggered: h.triggered,
    })),
    coverage,
    poorCoverage: result.enrichment.dataStatus === 'none' || extras.poorCoverage,
  });
  return {
    ...result,
    heuristics,
    score,
    riskLabel: riskFromScore(score),
    verdict,
    enrichment: { ...result.enrichment, note: [result.enrichment.note, extras.note].filter(Boolean).join(' ') },
  };
}

export async function enrichUrl(
  input: string,
  options: { deepScan?: boolean } = {},
): Promise<UrlAnalysis & { enrichment: Enrichment }> {
  const analysis = analyzeUrl(input);
  const domain = analysis.registrableDomain;
  const cached = cache.get(domain);
  let base: UrlAnalysis & { enrichment: Enrichment };
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    base = applyEnrichment(analysis, cached.value);
  } else {
    const [rdapResult, dnsResult, tlsResult, redirectResult] = await Promise.all([
      rdap(domain),
      resolveDns(domain),
      tlsCert(analysis.breakdown.host),
      followRedirects(analysis.normalized),
    ]);

    let liveCount = 0;
    if (rdapResult) liveCount++;
    if (dnsResult) liveCount++;
    if (tlsResult) liveCount++;
    if (redirectResult.live) liveCount++;

    const live = liveCount >= 2;
    const fixtureAvailable = hasFixture(domain);
    const dataStatus: Enrichment['dataStatus'] = live ? 'live' : fixtureAvailable ? 'fixture' : 'none';
    const enrichment: Enrichment = {
      mode: live ? 'live' : 'cached',
      dataStatus,
      redirects: live ? redirectResult.hops : dataStatus === 'fixture' ? redirectFixture(analysis.normalized) : [],
      registration: live
        ? rdapResult ?? emptyRegistration()
        : dataStatus === 'fixture'
          ? registrationFixture(domain)
          : emptyRegistration(),
      dns: live ? dnsResult ?? emptyDns() : dataStatus === 'fixture' ? dnsFixture(domain) : emptyDns(),
      tls: live
        ? tlsResult ?? emptyTls()
        : dataStatus === 'fixture'
          ? tlsFixture(analysis.breakdown.host)
          : emptyTls(),
      note:
        dataStatus === 'live'
          ? `Resolved live: ${liveCount}/4 network sources responded within ${TIMEOUT / 1000}s.`
          : dataStatus === 'fixture'
            ? FORCE_OFFLINE
              ? 'TRACE_FORCE_OFFLINE=1 — no outbound lookups attempted; documented demo fixture used for this domain.'
              : 'Network unavailable or lookup blocked — documented demo fixture used for this domain.'
            : 'No live or fixture data exists for this domain. Nothing was invented; registration, DNS, TLS and redirects are reported as unavailable.',
    };
    if (live) cache.set(domain, { value: enrichment, at: Date.now() });
    base = applyEnrichment(analysis, enrichment);
  }

  const reputation = await reputationLookup(analysis.normalized);
  let result = applyExtras(base, {
    heuristics: reputation.heuristics,
    checksRun: reputation.heuristics.length ? ['external reputation lookup'] : [],
    checksSkipped: reputation.skipped,
  });

  if (options.deepScan && DEEP_SCAN_ENABLED) {
    const scan = await deepScan(analysis.normalized);
    result = applyExtras(result, {
      heuristics: scan.heuristics,
      checksRun: scan.checksRun,
      checksSkipped: scan.checksSkipped,
      note: scan.note,
    });
  } else {
    const reason = DEEP_SCAN_ENABLED
      ? 'Deep scan is off; the landing page was not fetched.'
      : 'Deep scan is disabled in production by default; the landing page was not fetched.';
    result = applyExtras(result, {
      heuristics: [],
      checksRun: [],
      checksSkipped: [{ id: 'deep-scan', reason }],
    });
  }
  return result;
}
