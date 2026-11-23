import { parse as parseDomain } from 'tldts';
import { BLOCKLIST, BLOCKLIST_SOURCE } from './blocklist';
import { detectMixedScript, skeleton, toUnicodeHost } from './confusables';
import {
  BRANDS,
  KNOWN_TLDS,
  SUSPICIOUS_PATH_WORDS,
  SUSPICIOUS_TLDS,
  TOP_DOMAINS,
  URL_SHORTENERS,
} from './data';
import type { RiskLabel, UrlAnalysis, UrlBreakdown, UrlHeuristic } from './types';
import { computeVerdict } from './verdict';

export function riskFromScore(score: number): RiskLabel {
  if (score >= 60) return 'HIGH';
  if (score >= 30) return 'MEDIUM';
  return 'LOW';
}

export function ensureScheme(input: string): string {
  const trimmed = input.trim();
  if (/^(?:https?|ftp):\/\//i.test(trimmed)) return trimmed;
  // Script/data schemes are analysed as-is so they can be flagged, not rewritten into http.
  if (/^(?:javascript|data|vbscript|file|mailto|tel):/i.test(trimmed)) return trimmed;
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
  // tldts ships the full public suffix list, so multi-part suffixes work offline.
  const parsed = parseDomain(clean, { allowPrivateDomains: true });
  const registrable = parsed.domain ?? clean;
  const tld = parsed.publicSuffix ?? labels[labels.length - 1];
  const domain = parsed.domain && tld ? registrable.slice(0, Math.max(0, registrable.length - tld.length - 1)) : labels[0];
  return { labels, registrable, domain, tld };
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
  const scheme = url.protocol.replace(':', '').toLowerCase();
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

  const unicodeDomain = toUnicodeHost(breakdown.domain);
  const domainSkeleton = skeleton(unicodeDomain);
  const brandSkeletonMatch = (() => {
    if (isIp || domainSkeleton.length < 4) return null;
    if (BRANDS.some((b) => isOfficialHost(host, b))) return null;
    for (const brand of BRANDS) {
      for (const keyword of brand.keywords) {
        const ks = skeleton(keyword.replace(/\s+/g, ''));
        if (ks.length >= 4 && (ks === domainSkeleton || levenshtein(ks, domainSkeleton) <= 1)) {
          return { label: `${brand.name} (${keyword})`, official: brand.domains[0] ?? 'unknown' };
        }
      }
    }
    for (const domain of TOP_DOMAINS) {
      const label = skeleton(domain.split('.')[0]);
      if (label.length >= 4 && label === domainSkeleton && !TOP_DOMAINS.includes(registrable)) {
        return { label: domain, official: domain };
      }
    }
    return null;
  })();
  add(
    'homoglyph-skeleton',
    'Confusable skeleton matches a trusted name',
    30,
    Boolean(brandSkeletonMatch),
    brandSkeletonMatch
      ? [
          `skeleton "${domainSkeleton}" matches ${brandSkeletonMatch.label}`,
          `legitimate domain: ${brandSkeletonMatch.official}`,
          unicodeDomain !== domainSkeleton ? `decoded label: ${unicodeDomain}` : `raw label: ${breakdown.domain}`,
        ]
      : [],
    'After Unicode confusable folding, the registrable label reads as a protected brand or popular domain that this host does not own.',
    'identity',
  );

  const mixedLabels = labels
    .map((label) => ({ label, ...detectMixedScript(label) }))
    .filter((entry) => entry.mixed);
  add(
    'mixed-script',
    'Mixed-script homoglyph hostname',
    30,
    mixedLabels.length > 0,
    mixedLabels.map((entry) => `label "${entry.label}" decodes to "${entry.unicode}" (${entry.scripts.join(' + ')})`),
    'One label mixes Latin with Cyrillic or Greek letters that render identically — the classic homoglyph attack.',
    'identity',
  );

  const domainLetters = breakdown.domain.replace(/[^a-z]/g, '');
  const vowelRatio = domainLetters ? (domainLetters.match(/[aeiou]/g)?.length ?? 0) / domainLetters.length : 0.5;
  const digitRatio = breakdown.domain ? (breakdown.domain.match(/\d/g)?.length ?? 0) / breakdown.domain.length : 0;
  const labelEntropy = shannonEntropy(breakdown.domain);
  const randomLabel =
    !isIp && breakdown.domain.length >= 8 && labelEntropy > 3.5 && (vowelRatio < 0.2 || digitRatio > 0.25);
  add(
    'random-label',
    'Random-looking domain label',
    15,
    randomLabel,
    [`entropy ${labelEntropy.toFixed(2)}, vowel ratio ${vowelRatio.toFixed(2)}, digit ratio ${digitRatio.toFixed(2)}`],
    'Machine-generated labels lack normal vowel structure or mix in digits, which is typical of bulk phishing registration.',
  );

  const hostLureWords = [...new Set(SUSPICIOUS_PATH_WORDS.filter((word) => labels.some((label) => label.includes(word))))];
  add(
    'keyword-stuffing',
    'Lure-word stuffing in hostname',
    15,
    hostLureWords.length >= 3,
    hostLureWords.map((word) => `"${word}" in host`),
    'Three or more security or payment words packed into the hostname is a template signature, not a brand name.',
  );

  const knownDomains = new Set<string>([...TOP_DOMAINS, ...BRANDS.flatMap((brand) => brand.domains)]);
  let embeddedDomain = '';
  for (let i = 1; i < labels.length - 1; i++) {
    const candidate = labels.slice(0, i + 1).join('.');
    if (candidate !== registrable && knownDomains.has(candidate)) {
      embeddedDomain = candidate;
      break;
    }
  }
  add(
    'embedded-domain',
    'Another domain embedded in the host',
    25,
    Boolean(embeddedDomain),
    embeddedDomain ? [`host contains "${embeddedDomain}" before the real domain ${registrable}`] : [],
    'The host spells out a trusted domain inside its own name (paypal.com.evil.xyz); the real owner is the last labels.',
    'identity',
  );

  const knownLabels = new Map<string, string>();
  for (const domain of TOP_DOMAINS) {
    const label = domain.split('.')[0];
    if (!knownLabels.has(label)) knownLabels.set(label, domain);
  }
  for (const brand of BRANDS) {
    for (const domain of brand.domains) {
      const label = domain.split('.')[0];
      if (!knownLabels.has(label)) knownLabels.set(label, domain);
    }
  }
  const officialAny = BRANDS.some((brand) => isOfficialHost(host, brand)) || TOP_DOMAINS.includes(registrable);
  const tldSwap = !isIp && !officialAny && knownLabels.has(breakdown.domain);
  add(
    'tld-swap',
    'Trusted name reused on a different TLD',
    20,
    tldSwap,
    tldSwap ? [`"${breakdown.domain}" matches ${knownLabels.get(breakdown.domain)} but uses .${breakdown.tld}`] : [],
    'Reusing a well-known second-level name on a cheap or unfamiliar TLD is a common look-alike strategy.',
    'identity',
  );

  const registrableLabel = breakdown.domain.toLowerCase();
  const labelLureWords = [...new Set(SUSPICIOUS_PATH_WORDS.filter((word) => registrableLabel.includes(word)))];
  const riskyTld = SUSPICIOUS_TLDS.has(breakdown.tld.split('.').pop() ?? '');
  const brandInLabel = BRANDS.find(
    (brand) =>
      !isOfficialHost(host, brand) &&
      brand.keywords.some((keyword) => {
        const compact = keyword.replace(/\s+/g, '');
        return compact.length >= 3 && registrableLabel.includes(compact);
      }),
  );
  add(
    'brand-lure-tld',
    'Brand plus lure word on an abused TLD',
    25,
    Boolean(brandInLabel && labelLureWords.length > 0 && riskyTld && !officialAny),
    [
      brandInLabel
        ? `"${brandInLabel.keywords.find((k) => registrableLabel.includes(k.replace(/\s+/g, ''))) ?? brandInLabel.keywords[0]}" (${brandInLabel.name}) in label "${registrableLabel}"`
        : '',
      `lure word "${labelLureWords[0] ?? ''}" in the same label`,
      `TLD ".${breakdown.tld}" is on the high-abuse list`,
    ],
    'A protected name combined with security or account wording on a cheap TLD is a look-alike registration pattern, even when the brand keyword is not an exact match.',
    'identity',
  );
  add(
    'lure-word-tld',
    'Stacked lure words on an abused TLD',
    15,
    labelLureWords.length >= 2 && riskyTld && !officialAny,
    [
      `label "${registrableLabel}" contains ${labelLureWords.length} lure words: ${labelLureWords.map((w) => `"${w}"`).join(', ')}`,
      `TLD ".${breakdown.tld}" is on the high-abuse list`,
    ],
    'Several login/security words packed into the registrable label of a cheap TLD is a phishing template that does not depend on any brand list.',
    'structure',
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

  const dangerousScheme = ['javascript', 'data', 'vbscript', 'file'].includes(scheme);
  add(
    'dangerous-scheme',
    'Script or data URL scheme',
    35,
    dangerousScheme,
    dangerousScheme ? [`scheme is "${scheme}:"`] : [],
    'A javascript:, data: or file: link does not point to a website; it runs or embeds content in the browser context.',
    'structure',
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

  const pctCount = (url.pathname.match(/%[0-9a-f]{2}/gi) ?? []).length;
  const doubleEncoded = /%25[0-9a-f]{2}/i.test(`${url.pathname}${url.search}`);
  add(
    'encoded-path',
    'Encoded path obfuscation',
    10,
    doubleEncoded || pctCount >= 4,
    doubleEncoded ? ['double-encoded (%25xx) sequence in path'] : [`${pctCount} percent-encoded bytes in path`],
    'Heavy or double encoding hides the real path from filters and from the person reading the link.',
  );

  const listed = BLOCKLIST.includes(registrable) || BLOCKLIST.includes(host);
  add(
    'blocklist',
    'Listed on local blocklist',
    40,
    listed,
    listed ? [`${registrable} is listed in ${BLOCKLIST_SOURCE || 'the bundled blocklist'}`] : [],
    'The domain appears in a locally imported phishing blocklist snapshot.',
    'infrastructure',
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
  if (!isIp && !brandSkeletonMatch) {
    const label = breakdown.domain;
    for (const brand of BRANDS) {
      for (const keyword of brand.keywords) {
        const compact = keyword.replace(/\s+/g, '');
        if (compact.length < 3) continue;
        if (isOfficialHost(host, brand)) continue;
        const distance = Math.min(levenshtein(label, compact), levenshtein(skeleton(label), skeleton(compact)));
        const brandCombined =
          label.startsWith(`${compact}-`) ||
          label.startsWith(`${compact}1`) ||
          label.startsWith(`${compact}online`) ||
          label.includes(`${compact}-`);
        const maxDistance = compact.length <= 5 ? 1 : 2;
        if ((distance <= maxDistance && Math.abs(label.length - compact.length) <= 1 && compact.length >= 4) || brandCombined) {
          typosquatEvidence = [
            `registrable label "${label}" imitates "${keyword}"`,
            `edit distance to "${compact}": ${distance}`,
            `legitimate domain: ${brand.domains[0] ?? 'unknown'}`,
          ];
          typosquatBrand = brand.name;
          break;
        }
      }
      if (typosquatEvidence.length) break;
    }
    if (!typosquatEvidence.length && !TOP_DOMAINS.includes(registrable)) {
      for (const domain of TOP_DOMAINS) {
        const compact = domain.split('.')[0];
        if (compact.length < 4 || label === compact) continue;
        const distance = levenshtein(skeleton(label), skeleton(compact));
        if (distance <= 1) {
          typosquatEvidence = [
            `registrable label "${label}" is one edit from popular domain "${domain}"`,
            `skeleton distance: ${distance}`,
          ];
          typosquatBrand = compact;
          break;
        }
      }
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
    coverage: {
      checksRun: ['public-suffix and registrable-domain parsing', 'structural heuristics', 'brand and typosquat comparison'],
      checksSkipped: [
        { id: 'domain-age', reason: 'Registration age requires a live RDAP lookup.' },
        { id: 'dns-tls', reason: 'DNS and TLS checks are not part of static URL analysis.' },
        { id: 'reputation', reason: 'No reputation provider is configured.' },
        { id: 'deep-scan', reason: 'Page fetching is not enabled.' },
      ],
    },
  });

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
    verdict,
  };
}

export function isSuspiciousTld(tld: string): boolean {
  return SUSPICIOUS_TLDS.has(tld.split('.').pop() ?? '');
}

export function isKnownTld(tld: string): boolean {
  return KNOWN_TLDS.has(tld.split('.').pop() ?? '');
}
