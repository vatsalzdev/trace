import { promises as dns } from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import type { DnsInfo, Enrichment, RedirectHop, RegistrationInfo, TlsInfo, UrlAnalysis, UrlHeuristic } from '../../shared/types';
import { analyzeUrl, riskFromScore } from '../../shared/url';
import { dnsFixture, redirectFixture, registrationFixture, tlsFixture } from './fixtures';

const TIMEOUT = 4000;
const FORCE_OFFLINE = process.env.TRACE_FORCE_OFFLINE === '1';
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
  return { ...analysis, heuristics, score, riskLabel: riskFromScore(score), enrichment };
}

export async function enrichUrl(input: string): Promise<UrlAnalysis & { enrichment: Enrichment }> {
  const analysis = analyzeUrl(input);
  const domain = analysis.registrableDomain;
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return applyEnrichment(analysis, cached.value);
  }

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

  const mode: 'live' | 'cached' = liveCount >= 2 ? 'live' : 'cached';
  const enrichment: Enrichment = {
    mode,
    redirects: redirectResult.live ? redirectResult.hops : redirectFixture(analysis.normalized),
    registration: rdapResult ?? registrationFixture(domain),
    dns: dnsResult ?? dnsFixture(domain),
    tls: tlsResult ?? tlsFixture(analysis.breakdown.host),
    note: FORCE_OFFLINE
      ? 'TRACE_FORCE_OFFLINE=1 — no outbound lookups attempted; deterministic local fixtures used.'
      : mode === 'live'
        ? `Resolved live: ${liveCount}/4 network sources responded within ${TIMEOUT / 1000}s.`
        : 'Network unavailable or lookup blocked — deterministic local fixtures used. Analysis remains complete.',
  };
  if (mode === 'live') cache.set(domain, { value: enrichment, at: Date.now() });
  return applyEnrichment(analysis, enrichment);
}
