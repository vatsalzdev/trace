import {
  APK_PATTERNS,
  AUTHORITY_PATTERNS,
  BRANDS,
  CREDENTIAL_PATTERNS,
  EMAIL_DOMAINS,
  KNOWN_UPI_HANDLES,
  KYC_PATTERNS,
  PAYMENT_PATTERNS,
  PRIZE_PATTERNS,
  URGENCY_PATTERNS,
} from './data';
import type { ExtractedEntity, MessageAnalysis, Rule, Span } from './types';
import { analyzeUrl, isIpHost, isOfficialHost, parseBreakdown, riskFromScore, splitHost } from './url';

const TLDS =
  'com|in|net|org|io|co|info|biz|me|dev|app|ai|gov|edu|us|uk|au|ca|de|fr|ru|cn|jp|sg|ae|pk|bd|np|lk|br|za|sbi|link|online|site|store|tech|cloud|pro|mobi|asia|tv|cc|ws|to|ly|xyz|top|click|icu|vip|live|shop|cfd|sbs|buzz|fit|monster|rest|quest|cyou|bond|work|support|help|surf|tk|ml|ga|cf|gq|zip|mov|country|download|stream';

const URL_RE = new RegExp(
  `(?:https?:\\/\\/|www\\.)[^\\s<>"'\`]+|\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLDS})(?::\\d{2,5})?(?:\\/[^\\s<>"'\`]*)?`,
  'gi',
);
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;
const UPI_RE = /\b[a-z0-9][a-z0-9._-]{1,}@[a-z]{2,}\b/gi;
const PHONE_RE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const IFSC_RE = /\b[A-Z]{4}0[A-Z0-9]{6}\b/g;
const ACCOUNT_RE = /(?<![\d+/-])\d{9,18}(?![\d/-])/g;
const BTC_RE = /\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-zA-HJ-NP-Z0-9]{25,39})\b/g;
const ETH_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const TRX_RE = /\bT[a-zA-HJ-NP-Z1-9]{33}\b/g;
const OTP_MENTION_RE = /\b(?:otp|one[- ]time password|pin|cvv|password)\b/gi;

export function normalizeEntity(type: ExtractedEntity['type'], value: string): string {
  const v = value.trim();
  switch (type) {
    case 'domain':
      return v.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    case 'url': {
      try {
        const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `http://${v}`);
        return u.href.replace(/\/$/, '');
      } catch {
        return v.toLowerCase();
      }
    }
    case 'phone': {
      const digits = v.replace(/\D/g, '');
      return digits.length > 10 && digits.startsWith('91') ? digits.slice(2) : digits;
    }
    case 'upi':
    case 'email':
      return v.toLowerCase();
    case 'wallet':
      return v.toLowerCase();
    case 'account':
      return v.replace(/\D/g, '');
    case 'ip':
      return v.toLowerCase();
    default:
      return v.toLowerCase();
  }
}

function cleanUrlValue(value: string): string {
  return value.replace(/[.,;:!?)\]}"']+$/, '');
}

function collect(regex: RegExp, text: string): Span[] {
  const out: Span[] = [];
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    out.push({ value: m[0], start: m.index, end: m.index + m[0].length });
    if (out.length > 200) break;
  }
  return out;
}

function overlaps(a: Span, spans: Span[]): boolean {
  return spans.some((s) => a.start < s.end && a.end > s.start);
}

function collectPatterns(patterns: RegExp[], text: string): string[] {
  const found = new Set<string>();
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      found.add(m[0].trim());
      if (found.size > 24) break;
    }
  }
  return [...found];
}

export function extractEntities(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];

  const urlSpans = collect(URL_RE, text)
    .filter((s) => {
      const hasScheme = /^(https?:\/\/|www\.)/i.test(s.value);
      const before = text[s.start - 1] ?? '';
      const after = text[s.end] ?? '';
      if (after === '@') return false;
      if (!hasScheme && /[a-z0-9@._-]/i.test(before)) return false;
      return true;
    })
    .map((s) => ({ ...s, value: cleanUrlValue(s.value) }))
    .filter((s) => s.value.length > 3);
  for (const span of urlSpans) {
    let host = '';
    try {
      host = parseBreakdown(span.value).url.hostname;
    } catch {
      host = '';
    }
    entities.push({ ...span, type: 'url', normalized: normalizeEntity('url', span.value) });
    if (host) {
      const { registrable } = splitHost(host);
      const domain = registrable || host;
      const offset = span.value.toLowerCase().indexOf(domain.toLowerCase());
      entities.push({
        value: domain,
        start: span.start + (offset >= 0 ? offset : 0),
        end: span.start + (offset >= 0 ? offset : 0) + domain.length,
        type: 'domain',
        normalized: domain.toLowerCase(),
      });
      if (isIpHost(host)) {
        entities.push({ value: host, start: span.start, end: span.end, type: 'ip', normalized: host.toLowerCase() });
      }
    }
  }

  const emailSpans = collect(EMAIL_RE, text);
  for (const span of emailSpans) {
    entities.push({ ...span, type: 'email', normalized: normalizeEntity('email', span.value) });
  }

  for (const span of collect(UPI_RE, text)) {
    if (overlaps(span, emailSpans) || overlaps(span, urlSpans)) continue;
    const handle = span.value.split('@')[1]?.toLowerCase() ?? '';
    if (EMAIL_DOMAINS.has(handle)) continue;
    entities.push({
      ...span,
      type: 'upi',
      normalized: normalizeEntity('upi', span.value),
      suspicious: !KNOWN_UPI_HANDLES.has(handle),
      note: KNOWN_UPI_HANDLES.has(handle) ? `known PSP handle @${handle}` : `unregistered handle @${handle}`,
    });
  }

  for (const span of collect(PHONE_RE, text)) {
    if (overlaps(span, urlSpans) || overlaps(span, emailSpans)) continue;
    entities.push({ ...span, type: 'phone', normalized: normalizeEntity('phone', span.value) });
  }

  for (const span of collect(IFSC_RE, text)) {
    entities.push({ ...span, type: 'ifsc', normalized: span.value.toUpperCase() });
  }

  for (const span of collect(ACCOUNT_RE, text)) {
    if (overlaps(span, urlSpans) || overlaps(span, emailSpans)) continue;
    if (overlaps(span, entities.map((e) => ({ value: e.value, start: e.start, end: e.end })))) continue;
    const context = text.slice(Math.max(0, span.start - 48), span.end + 24).toLowerCase();
    if (/\b(?:a\/c|account|acct|beneficiary|transfer to)\b/.test(context)) {
      entities.push({ ...span, type: 'account', normalized: normalizeEntity('account', span.value), note: 'account number context' });
    }
  }

  const wallets: { re: RegExp; kind: string }[] = [
    { re: BTC_RE, kind: 'BTC' },
    { re: ETH_RE, kind: 'ETH' },
    { re: TRX_RE, kind: 'TRX' },
  ];
  for (const w of wallets) {
    for (const span of collect(w.re, text)) {
      entities.push({ ...span, type: 'wallet', normalized: span.value, note: w.kind });
    }
  }

  const seen = new Set<string>();
  return entities
    .filter((e) => {
      const key = `${e.type}:${e.normalized}:${e.start}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function rule(
  id: string,
  name: string,
  weight: number,
  evidence: string[],
  explanation: string,
  triggered: boolean,
  category?: string,
): Rule {
  return { id, name, weight, triggered, evidence: triggered ? [...new Set(evidence)].slice(0, 6) : [], explanation, category };
}

export function analyzeMessage(text: string): MessageAnalysis {
  const input = text ?? '';
  const entities = extractEntities(input);
  const urlEntities = entities.filter((e) => e.type === 'url');
  const urlAnalyses = urlEntities.map((e) => ({ span: { value: e.value, start: e.start, end: e.end }, analysis: analyzeUrl(e.value) }));
  const maxUrlScore = urlAnalyses.reduce((max, u) => Math.max(max, u.analysis.score), 0);
  const offendingUrl = urlAnalyses.find((u) => u.analysis.score >= 40 || u.analysis.brandMatch);

  const urgency = collectPatterns(URGENCY_PATTERNS, input);
  const kyc = collectPatterns(KYC_PATTERNS, input);
  const credential = collectPatterns(CREDENTIAL_PATTERNS, input);
  const authority = collectPatterns(AUTHORITY_PATTERNS, input);
  const prize = collectPatterns(PRIZE_PATTERNS, input);
  const paymentWords = collectPatterns(PAYMENT_PATTERNS, input);
  const apkWords = collectPatterns(APK_PATTERNS, input);
  const otpMentions = collectPatterns([OTP_MENTION_RE], input);

  const brandHits: { brand: (typeof BRANDS)[number]; keyword: string }[] = [];
  for (const brand of BRANDS) {
    for (const keyword of brand.keywords) {
      if (input.toLowerCase().includes(keyword)) {
        brandHits.push({ brand, keyword });
        break;
      }
    }
  }

  const brandUrls = urlAnalyses.filter((u) => {
    const host = (() => {
      try {
        return parseBreakdown(u.span.value).url.hostname;
      } catch {
        return '';
      }
    })();
    if (!host) return false;
    return brandHits.some((b) => !isOfficialHost(host, b.brand));
  });

  const upis = entities.filter((e) => e.type === 'upi');
  const shortenerUrl = urlAnalyses.find((u) => u.analysis.isShortener);
  const httpUrl = urlAnalyses.find((u) => u.span.value.toLowerCase().startsWith('http://'));
  const apkLink = urlAnalyses.find((u) => /\.apk(?:$|\?|\/)/i.test(u.span.value));

  const paymentTriggered = upis.length > 0 || paymentWords.length > 0 || entities.some((e) => e.type === 'account');
  const credentialTriggered = credential.length > 0;
  const brandTriggered = brandHits.length > 0 && brandUrls.length > 0;

  const rules: Rule[] = [
    rule(
      'urgency',
      'Urgency language',
      15,
      urgency.map((u) => `"${u}"`),
      'Time pressure suppresses deliberation. These phrases demand action before the recipient can verify the claim.',
      urgency.length > 0,
      'coercion',
    ),
    rule(
      'brand',
      'Financial / government impersonation',
      25,
      brandHits.flatMap((b) => [
        `brand "${b.brand.name}" invoked via "${b.keyword}"`,
        ...brandUrls.map((u) => `link does not belong to ${b.brand.name}: ${u.analysis.registrableDomain} (official: ${b.brand.domains[0]})`),
      ]),
      'A regulated brand is named while the message links to a domain the brand does not own. A brand name alone is not evidence; the mismatch is.',
      brandTriggered,
      'identity',
    ),
    rule(
      'domain',
      'Suspicious domain structure',
      25,
      maxUrlScore >= 40 && offendingUrl
        ? [
            `${offendingUrl.analysis.registrableDomain} scores ${offendingUrl.analysis.score}/100`,
            ...offendingUrl.analysis.heuristics.filter((h) => h.triggered).map((h) => `${h.name}: ${h.evidence[0] ?? 'triggered'}`),
          ]
        : [],
      'The linked domain independently fails structural checks in the URL engine (brand mismatch, TLD, typosquat or obfuscation).',
      maxUrlScore >= 40,
      'identity',
    ),
    rule(
      'http',
      'Insecure HTTP link',
      10,
      httpUrl ? [`${httpUrl.span.value} uses http://`] : [],
      'Any credential or payment page served over plain HTTP is unsafe regardless of how it looks.',
      Boolean(httpUrl),
      'transport',
    ),
    rule(
      'payment',
      'Payment request / identifier',
      10,
      [
        ...upis.map((u) => `UPI ${u.value}${u.suspicious ? ' (unregistered handle)' : ''}`),
        ...entities.filter((e) => e.type === 'account').map((e) => `account number ${e.value}`),
        ...paymentWords.map((w) => `payment language "${w}"`),
      ],
      'The message routes the recipient toward a payment instrument — a UPI ID, wallet or bank account.',
      paymentTriggered,
      'financial',
    ),
    rule(
      'credential',
      'Credential / OTP harvesting',
      15,
      credential.map((c) => `"${c}"`),
      'The message asks for an OTP, PIN, CVV or identity document, or pairs a document name with an action verb.',
      credentialTriggered,
      'credential',
    ),
    rule(
      'shortener',
      'URL shortener obfuscation',
      10,
      shortenerUrl ? [`${shortenerUrl.analysis.breakdown.host} hides the final destination`] : [],
      'A shortener prevents the recipient from seeing the destination before clicking.',
      Boolean(shortenerUrl),
      'transport',
    ),
    rule(
      'kyc',
      'KYC / verification lure',
      10,
      kyc.map((k) => `"${k}"`),
      'KYC and re-verification are the most common pretexts for Indian banking fraud.',
      kyc.length > 0,
      'pretext',
    ),
    rule(
      'authority',
      'Authority / threat pressure',
      10,
      authority.map((a) => `"${a}"`),
      'Threats of arrest, FIR or legal action create fear that short-circuits verification.',
      authority.length > 0,
      'coercion',
    ),
    rule(
      'prize',
      'Reward / lottery lure',
      10,
      prize.map((p) => `"${p}"`),
      'Unexpected winnings, refunds or cashback are used to pull the recipient into a payment flow.',
      prize.length > 0,
      'pretext',
    ),
    rule(
      'apk',
      'APK / app install request',
      15,
      [...apkWords.map((a) => `"${a}"`), ...(apkLink ? [`link to ${apkLink.span.value}`] : [])],
      'A link to an Android package installs code outside the Play Store, where banking trojans are distributed.',
      apkWords.length > 0 || Boolean(apkLink),
      'malware',
    ),
  ];

  const triggered = rules.filter((r) => r.triggered);
  const score = Math.min(100, triggered.reduce((sum, r) => sum + r.weight, 0));
  const riskLabel = riskFromScore(score);

  const keywords = [
    { category: 'Urgency', matches: urgency },
    { category: 'KYC', matches: kyc },
    { category: 'Credential', matches: credential },
    { category: 'Authority', matches: authority },
    { category: 'Reward', matches: prize },
    { category: 'Payment', matches: paymentWords },
    { category: 'App install', matches: apkWords },
    { category: 'OTP / PIN mention', matches: otpMentions },
  ].filter((k) => k.matches.length > 0);

  const summary = buildSummary({ riskLabel, score, triggered, brandHits, brandUrls, upis, credential, authority, apkLink, maxUrlScore, urlAnalyses });

  return { input, score, riskLabel, rules, entities, keywords, urls: urlAnalyses, summary };
}

function buildSummary(args: {
  riskLabel: string;
  score: number;
  triggered: Rule[];
  brandHits: { brand: (typeof BRANDS)[number]; keyword: string }[];
  brandUrls: { span: Span; analysis: ReturnType<typeof analyzeUrl> }[];
  upis: ExtractedEntity[];
  credential: string[];
  authority: string[];
  apkLink?: { span: Span; analysis: ReturnType<typeof analyzeUrl> };
  maxUrlScore: number;
  urlAnalyses: { span: Span; analysis: ReturnType<typeof analyzeUrl> }[];
}): string {
  const { riskLabel, score, triggered, brandHits, brandUrls, upis, credential, authority, apkLink, maxUrlScore, urlAnalyses } = args;
  if (!triggered.length) {
    return 'No coercion, credential-harvesting, payment-redirection or malware-delivery signals were found. The message does not prove authenticity — treat unexpected requests with caution and verify through the official app.';
  }
  const parts: string[] = [];
  const top = [...triggered].sort((a, b) => b.weight - a.weight).slice(0, 3);
  parts.push(
    `This message is a ${riskLabel.toLowerCase()}-risk artefact. It triggers ${triggered.length} of ${11} rules for a combined weight of ${score} (capped at 100).`,
  );
  parts.push(`The strongest signals are ${top.map((r) => `${r.name.toLowerCase()} (${r.weight})`).join(', ')}.`);
  if (brandHits.length && brandUrls.length) {
    const b = brandHits[0];
    const u = brandUrls[0];
    parts.push(
      `It invokes ${b.brand.name} while directing the recipient to ${u.analysis.registrableDomain}, which is not an official ${b.brand.name} domain (${b.brand.domains[0]}).`,
    );
  } else if (urlAnalyses.length) {
    const worst = [...urlAnalyses].sort((a, b) => b.analysis.score - a.analysis.score)[0];
    parts.push(
      `The linked destination ${worst.analysis.registrableDomain} scores ${worst.analysis.score}/100 on structural checks${worst.analysis.brandMatch ? ` and imitates ${worst.analysis.brandMatch}` : ''}.`,
    );
  }
  if (upis.length) {
    const unknown = upis.find((u) => u.suspicious);
    parts.push(
      unknown
        ? `Payment is redirected to ${unknown.value}, which uses an unregistered UPI handle — no regulated PSP issues it.`
        : `Payment is redirected to the UPI ID ${upis[0].value}.`,
    );
  }
  if (credential.length) parts.push('The message solicits an OTP, PIN, CVV or identity document; no bank or government agency asks for these over SMS.');
  if (authority.length) parts.push('Threat language is present; genuine agencies do not conduct arrests or demand payment over messaging apps.');
  if (apkLink) parts.push(`It links to an Android package (${apkLink.span.value}), which bypasses Play Store review.`);
  if (maxUrlScore >= 40) parts.push('Do not open the link. Preserve the message and report it to 1930 (national cybercrime helpline).');
  return parts.join(' ');
}

export interface SampleMessage {
  id: string;
  label: string;
  channel: string;
  text: string;
}

export const SAMPLE_MESSAGES: SampleMessage[] = [
  {
    id: 'sbi-kyc',
    label: 'SBI KYC suspension',
    channel: 'SMS',
    text: 'URGENT! Your SBI account will be blocked today. Complete KYC immediately: http://sbi-kyc-verify.example.com Pay verification fee to: support@fakebank',
  },
  {
    id: 'courier',
    label: 'Courier held at customs',
    channel: 'WhatsApp',
    text: 'Dear customer, your parcel from FedEx is held at customs due to illegal items. Clear within 24 hours or legal action will be taken. Pay customs fee Rs 1,499 at bit.ly/parcel-clear or UPI customs.clear@fakebank. Call +91 98765 43210.',
  },
  {
    id: 'refund',
    label: 'UPI refund scam',
    channel: 'SMS',
    text: 'Your refund of Rs 2,499 from Amazon has failed. To claim, send your UPI PIN to our agent on 91234 56789 or pay processing charge of Rs 99 to refund.help@ybl. Verify at http://amazon-refund.top/claim',
  },
  {
    id: 'arrest',
    label: 'Digital arrest threat',
    channel: 'WhatsApp',
    text: 'This is the final warning from CBI. A money laundering FIR has been registered against your Aadhaar. Digital arrest will begin in 2 hours unless you share OTP for verification. Contact investigating officer at +91 90123 45678. Do not tell police.',
  },
  {
    id: 'loan-apk',
    label: 'Loan app APK',
    channel: 'SMS',
    text: 'Your pre-approved loan of Rs 50,000 is ready. Download app now: http://sbi-kyc-verify.in/app/loan-update.apk Install the app and complete KYC to receive funds in 10 minutes.',
  },
  {
    id: 'otp-control',
    label: 'Genuine OTP (control)',
    channel: 'SMS',
    text: '123456 is your OTP for txn of Rs 500 at AMAZON. Do not share this OTP with anyone. -HDFC Bank',
  },
];
