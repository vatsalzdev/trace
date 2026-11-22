import {
  BRANDS,
  KNOWN_TLDS,
  MULTI_PART_SUFFIXES,
  SUSPICIOUS_PATH_WORDS,
  SUSPICIOUS_TLDS,
  URL_SHORTENERS,
} from './data';
import type { RiskLabel, UrlAnalysis, UrlBreakdown, UrlHeuristic } from './types';

export function riskFromScore(score: number): RiskLabel {
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

export function ensureScheme(input: string): string {
  const trimmed = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.includes('/')) return trimmed;
  return `http://${trimmed.replace(/^\/+/, '')}`;
}

export function isIpHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || /^\[?[a-f0-9:]+\]?$/i.test(host) && host.includes(':');
}

export function splitHost(host: string): { labels: string[]; registrable: string; domain: string; tld: string } {
  const clean = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIpHost(clean)) return { labels: [clean], registrable: clean, domain: clean, tld: '' };
  const labels = clean.split('.').filter(Boolean);
  if (labels.length <= 1) return { labels, registrable: clean, domain: clean, tld: '' };
  const last2 = labels.slice(-2).join('.');
  const suffix = MULTI_PART_SUFFIXES.includes(last2) ? last2 : labels[labels.length - 1];
  const suffixParts = suffix.split('.').length;
  const domain = labels[labels.length - suffixParts - 1] ?? '';
  const registrable = [domain, suffix].filter(Boolean).join('.');
  return { labels, registrable, domain, tld: suffix };
}

export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[n];
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function brandMentionedIn(value: string): { brand: (typeof BRANDS)[number]; keyword: string } | null {
  const lower = value.toLowerCase();
  const tokens = new Set(tokenize(lower));
  for (const brand of BRANDS) {
    for (const keyword of brand.keywords) {
      if (keyword.includes(' ')) {
        if (lower.includes(keyword)) return { brand, keyword };
      } else if (tokens.has(keyword) || lower.includes(keyword)) {
        return { brand, keyword };
      }
    }
  }
  return null;
}

export function isOfficialHost(host: string, brand: (typeof BRANDS)[number]): boolean {
  const clean = host.toLowerCase().replace(/\.$/, '');
  return brand.domains.some((d) => clean === d || clean.endsWith(`.${d}`));
}

export function parseBreakdown(input: string): { url: URL; breakdown: UrlBreakdown; registrable: string; isIp: boolean } {
  const normalized = ensureScheme(input);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    url = new URL(`http://${input.replace(/^\/+/, '')}`);
  }
  const host = url.hostname.toLowerCase();
  const ip = isIpHost(host);
  const parts = splitHost(host);
  const labels = host.split('.');
  const subdomain = ip ? '' : labels.slice(0, Math.max(0, labels.length - parts.registrable.split('.').length)).join('.');
  const breakdown: UrlBreakdown = {
    protocol: url.protocol.replace(':', ''),
    host,
    subdomain,
    domain: ip ? host : parts.domain,
    tld: ip ? '' : parts.tld,
    port: url.port,
    path: url.pathname === '/' ? '' : url.pathname,
    query: url.search.replace(/^\?/, ''),
  };
  return { url, breakdown, registrable: parts.registrable, isIp: ip };
}

/** Pure, deterministic URL analysis. Network enrichment is applied server-side. */
export function analyzeUrl(input: string): UrlAnalysis {
  const { url, breakdown, registrable, isIp } = parseBreakdown(input);
  const host = url.hostname.toLowerCase();
  const full = url.href;
  const heuristics: UrlHeuristic[] = [];

  const add = (
    id: string,
    name: string,
    weight: number,
    triggered: boolean,
    evidence: string[],
    explanation: string,
    category = 'structure',
  ) => {
    heuristics.push({ id, name, weight, triggered, evidence: triggered ? evidence : [], explanation, category });
  };

  const labels = host.split('.');
  const subdomainLabels = isIp ? [] : labels.slice(0, Math.max(0, labels.length - registrable.split('.').length));
  add(
    'subdomain-depth',
    'Deep subdomain nesting',
    10,
    subdomainLabels.length > 3,
    [`${subdomainLabels.length} subdomain labels: ${subdomainLabels.join('.') || 'none'}`],
    'Four or more subdomain levels are commonly used to bury a recognisable brand deep inside a long host.',
  );

  const hostAndPath = `${host}${url.pathname}`.toLowerCase();
  const brandHit = brandMentionedIn(hostAndPath);
  const official = brandHit ? isOfficialHost(host, brandHit.brand) : true;
  add(
    'brand-impersonation',
    'Brand used outside its official domain',
    30,
    Boolean(brandHit && !official),
    brandHit
      ? [`"${brandHit.keyword}" appears in ${host}${url.pathname}`, `official domains: ${brandHit.brand.domains.join(', ')}`]
      : [],
    'A protected brand appears in the host or path, but the registrable domain is not owned by that brand.',
    'identity',
  );

  const hyphenCount = (host.match(/-/g) ?? []).length;
  add(
    'hyphens',
    'Hyphen-stacked hostname',
    10,
    hyphenCount >= 2,
    [`${hyphenCount} hyphens in "${host}"`],
    'Scam domains chain descriptive words with hyphens to look official (e.g. secure-login-verify).',
  );

  add(
    'digits-in-domain',
    'Numeric padding in hostname',
    8,
    !isIp && /\d/.test(breakdown.domain),
    [`"${breakdown.domain}" contains digits`],
    'Digits in the registrable label are often used to mint look-alike domains at scale.',
  );

  const puny = host.startsWith('xn--') || host.includes('.xn--') || /[^\x00-\x7F]/.test(host);
  add(
    'punycode',
    'Punycode or homoglyph hostname',
    25,
    puny,
    [`raw hostname: ${host}`],
    'Internationalised or punycode characters can render as a different Latin brand name (homoglyph attack).',
    'identity',
  );

  add(
    'suspicious-tld',
    'High-abuse TLD',
    15,
    SUSPICIOUS_TLDS.has(breakdown.tld.split('.').pop() ?? ''),
    [`TLD ".${breakdown.tld}" is on the high-abuse list`],
    'This top-level domain is cheap, lightly policed and over-represented in phishing campaigns.',
  );

  add(
    'ip-host',
    'Raw IP address instead of a domain',
    25,
    isIp,
    [`host is the literal IP ${host}`],
    'Legitimate consumer services rarely publish links to a bare IP address.',
    'infrastructure',
  );

  const port = url.port;
  const nonStandard = Boolean(port && !['80', '443', ''].includes(port));
  add(
    'port',
    'Non-standard network port',
    10,
    nonStandard,
    [`port ${port} in ${full}`],
    'Ports other than 80/443 bypass common URL filters and are unusual for public services.',
    'infrastructure',
  );

  add(
    'http',
    'Unencrypted HTTP transport',
    10,
    url.protocol === 'http:',
    [`${url.protocol}//${url.host}`],
    'Credentials submitted over plain HTTP can be read or modified in transit.',
    'transport',
  );

  const hasAt = /^[a-z]+:\/\/[^/]*@/i.test(full);
  add(
    'at-sign',
    'Userinfo obfuscation (@ in URL)',
    20,
    hasAt,
    [`${full.split('?')[0]}`],
    'Everything before @ is userinfo; browsers ignore it, so the real destination hides after the @.',
    'identity',
  );

  add(
    'length',
    'Unusually long URL',
    5,
    full.length > 100,
    [`${full.length} characters`],
    'Long URLs push the real destination out of view in mobile address bars and chat previews.',
  );

  const pathLower = `${url.pathname}${url.search}`.toLowerCase();
  const pathHits = SUSPICIOUS_PATH_WORDS.filter((w) => pathLower.includes(w));
  add(
    'suspicious-path',
    'Credential-harvesting path words',
    10,
    pathHits.length > 0,
    pathHits.map((w) => `"${w}" in path/query`),
    'Paths named for login, KYC or refund flows indicate a credential or payment capture page.',
    'intent',
  );

  const shortener = URL_SHORTENERS.has(host) || URL_SHORTENERS.has(registrable);
  add(
    'shortener',
    'URL shortener',
    10,
    shortener,
    shortener ? [`${host} is a known shortener`] : [],
    'Shorteners hide the final destination until the link is opened.',
    'transport',
  );

  const entropy = shannonEntropy(breakdown.domain);
  add(
    'entropy',
    'High-entropy domain label',
    10,
    entropy > 3.8 && breakdown.domain.length >= 8,
    [`Shannon entropy ${entropy.toFixed(2)} on "${breakdown.domain}"`],
    'Randomly generated labels indicate automated phishing-domain registration.',
  );

  // Typosquat / brand-combination detection on the registrable label.
  let typosquatEvidence: string[] = [];
  let typosquatBrand = '';
  if (!isIp) {
    for (const brand of BRANDS) {
      for (const keyword of brand.keywords) {
        const compact = keyword.replace(/\s+/g, '');
        if (compact.length < 3) continue;
        const label = breakdown.domain;
        if (isOfficialHost(host, brand)) continue;
        const distance = levenshtein(label, compact);
        const brandCombined =
          label.startsWith(`${compact}-`) ||
          label.startsWith(`${compact}1`) ||
          label.startsWith(`${compact}online`) ||
          label.includes(`${compact}-`);
        if ((distance <= 2 && Math.abs(label.length - compact.length) <= 2 && compact.length >= 4) || brandCombined) {
          typosquatEvidence = [
            `registrable label "${label}" imitates "${keyword}"`,
            `edit distance to "${compact}": ${distance}`,
            `legitimate domain: ${brand.domains[0]}`,
          ];
          typosquatBrand = brand.name;
          break;
        }
      }
      if (typosquatEvidence.length) break;
    }
  }
  add(
    'typosquat',
    'Typosquat / brand-combination domain',
    30,
    typosquatEvidence.length > 0,
    typosquatEvidence,
    typosquatBrand
      ? `The registrable domain is a look-alike of ${typosquatBrand}; the brand does not own it.`
      : 'The registrable label is within two edits of a protected brand or combines a brand with lure words.',
    'identity',
  );

  const score = Math.min(100, heuristics.reduce((sum, h) => sum + (h.triggered ? h.weight : 0), 0));
  const brandMatch = brandHit && !official ? brandHit.brand.name : undefined;

  return {
    input,
    normalized: url.href,
    score,
    riskLabel: riskFromScore(score),
    heuristics,
    breakdown,
    registrableDomain: registrable,
    brandMatch: brandMatch ?? (typosquatBrand || undefined),
    isShortener: shortener,
    isIp,
  };
}

export function isSuspiciousTld(tld: string): boolean {
  return SUSPICIOUS_TLDS.has(tld.split('.').pop() ?? '');
}

export function isKnownTld(tld: string): boolean {
  return KNOWN_TLDS.has(tld.split('.').pop() ?? '');
}
