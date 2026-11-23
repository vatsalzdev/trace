import type { CoverageCheck, UrlHeuristic } from '../../shared/types';

const TIMEOUT_MS = 4000;
const CACHE_TTL = 10 * 60 * 1000;
const GSB_KEY = process.env.GSB_API_KEY?.trim() ?? '';
const VT_KEY = process.env.VT_API_KEY?.trim() ?? '';

const cache = new Map<string, { at: number; heuristics: UrlHeuristic[]; skipped: CoverageCheck[] }>();

function finding(id: string, name: string, weight: number, evidence: string[], explanation: string): UrlHeuristic {
  return { id, name, weight, triggered: true, evidence, explanation, category: 'reputation' };
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function googleSafeBrowsing(url: string): Promise<UrlHeuristic[]> {
  const res = await withTimeout((signal) =>
    fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(GSB_KEY)}`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'trace', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
    }),
  );
  if (!res.ok) throw new Error(`Google Safe Browsing returned ${res.status}`);
  const body = (await res.json()) as { matches?: Array<{ threatType?: string }> };
  if (!body.matches?.length) return [];
  const types = [...new Set(body.matches.map((m) => m.threatType).filter(Boolean))];
  return [
    finding(
      'reputation-gsb',
      'Listed by Google Safe Browsing',
      40,
      types.map((type) => `threat type: ${type}`),
      'Google Safe Browsing currently lists this exact URL as a threat. This is an external reputation signal, not a local rule.',
    ),
  ];
}

async function virusTotal(url: string): Promise<UrlHeuristic[]> {
  const id = Buffer.from(url).toString('base64url');
  const res = await withTimeout((signal) =>
    fetch(`https://www.virustotal.com/api/v3/urls/${id}`, {
      signal,
      headers: { 'x-apikey': VT_KEY },
    }),
  );
  if (!res.ok) throw new Error(`VirusTotal returned ${res.status}`);
  const body = (await res.json()) as {
    data?: { attributes?: { last_analysis_stats?: { malicious?: number; suspicious?: number } } };
  };
  const stats = body.data?.attributes?.last_analysis_stats;
  const malicious = stats?.malicious ?? 0;
  const suspicious = stats?.suspicious ?? 0;
  if (malicious + suspicious === 0) return [];
  return [
    finding(
      'reputation-vt',
      'Flagged by VirusTotal engines',
      malicious > 0 ? 40 : 20,
      [`${malicious} malicious and ${suspicious} suspicious engine verdicts`],
      'VirusTotal aggregates third-party engines. Engine votes are noisy, so this only adds weight alongside local evidence.',
    ),
  ];
}

/**
 * Optional reputation. Never required for a verdict: with no keys, or a failed
 * lookup, the caller gets a skipped-check entry and the analysis continues.
 */
export async function reputationLookup(url: string): Promise<{ heuristics: UrlHeuristic[]; skipped: CoverageCheck[] }> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return { heuristics: cached.heuristics, skipped: cached.skipped };
  }
  if (!GSB_KEY && !VT_KEY) {
    return {
      heuristics: [],
      skipped: [{ id: 'reputation', reason: 'No reputation provider is configured (GSB_API_KEY / VT_API_KEY unset).' }],
    };
  }
  const heuristics: UrlHeuristic[] = [];
  const skipped: CoverageCheck[] = [];
  const jobs: Array<[string, Promise<UrlHeuristic[]>]> = [];
  if (GSB_KEY) jobs.push(['Google Safe Browsing', googleSafeBrowsing(url)]);
  if (VT_KEY) jobs.push(['VirusTotal', virusTotal(url)]);
  const results = await Promise.allSettled(jobs.map(([, job]) => job));
  results.forEach((result, index) => {
    const name = jobs[index][0];
    if (result.status === 'fulfilled') heuristics.push(...result.value);
    else skipped.push({ id: `reputation-${name.toLowerCase().replace(/\s+/g, '-')}`, reason: `${name} lookup failed: ${result.reason instanceof Error ? result.reason.message : 'unknown error'}` });
  });
  cache.set(url, { at: Date.now(), heuristics, skipped });
  return { heuristics, skipped };
}
