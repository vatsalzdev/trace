import * as cheerio from 'cheerio';
import type { CoverageCheck, UrlHeuristic } from '../../shared/types';
import { BRANDS } from '../../shared/data';
import { splitHost } from '../../shared/url';
import { fetchPublicPage } from './ssrf';

export interface DeepScanResult {
  fetched: boolean;
  finalUrl: string;
  status: number;
  heuristics: UrlHeuristic[];
  checksRun: string[];
  checksSkipped: CoverageCheck[];
  note: string;
}

const OTP_FIELD_RE = /(otp|pin\b|cvv|aadhaar|aadhar|card.?number|expiry|ifsc|upi.?pin|mpin)/i;

function registrableOf(value: string): string {
  try {
    return splitHost(new URL(value).hostname).registrable;
  } catch {
    return '';
  }
}

function finding(
  id: string,
  name: string,
  weight: number,
  triggered: boolean,
  evidence: string[],
  explanation: string,
  category: string,
): UrlHeuristic {
  return { id, name, weight, triggered, evidence: triggered ? [...new Set(evidence)].slice(0, 6) : [], explanation, category };
}

/** Static, offline analysis of one already-fetched HTML page. */
export function analyseHtml(html: string, finalUrl: string, host: string): UrlHeuristic[] {
  const $ = cheerio.load(html);
  const pageDomain = registrableOf(finalUrl) || splitHost(host).registrable;
  const out: UrlHeuristic[] = [];

  const passwordFields = $('input[type="password"]');
  const fieldNames = $('input')
    .map((_, el) => $(el).attr('name') || $(el).attr('id') || '')
    .get()
    .filter(Boolean);
  out.push(
    finding(
      'deep-login-form',
      'Password field on the landing page',
      20,
      passwordFields.length > 0,
      [
        `${passwordFields.length} password input${passwordFields.length === 1 ? '' : 's'}`,
        ...fieldNames.slice(0, 4).map((name) => `field "${name}"`),
      ],
      'A page that asks for a password is capturing credentials. On a link from an unsolicited message this is the hostile case.',
      'content',
    ),
  );

  const crossActions: string[] = [];
  $('form').each((_, form) => {
    const action = $(form).attr('action');
    if (!action) return;
    const target = registrableOf(new URL(action, finalUrl).href);
    if (target && target !== pageDomain) crossActions.push(`${action} -> ${target}`);
  });
  out.push(
    finding(
      'deep-cross-form',
      'Form posts to another domain',
      25,
      crossActions.length > 0,
      crossActions,
      'A login form whose action points at a different registrable domain sends what the user types to a third party.',
      'structure',
    ),
  );

  const sensitive = fieldNames.filter((name) => OTP_FIELD_RE.test(name));
  out.push(
    finding(
      'deep-sensitive-fields',
      'OTP, PIN, CVV or identity fields',
      25,
      sensitive.length > 0,
      sensitive.map((name) => `field "${name}"`),
      'No legitimate website asks for an OTP, UPI PIN, card CVV or Aadhaar number as part of a link flow.',
      'content',
    ),
  );

  const title = `${$('title').text()} ${$('h1').first().text()}`.toLowerCase();
  const altText = $('img')
    .map((_, el) => $(el).attr('alt') ?? '')
    .get()
    .join(' ')
    .toLowerCase();
  const brandMismatch: string[] = [];
  for (const brand of BRANDS) {
    if (brand.domains.some((domain) => pageDomain === domain || pageDomain.endsWith(`.${domain}`))) continue;
    for (const keyword of brand.keywords) {
      if (keyword.length < 3) continue;
      if (title.includes(keyword) || altText.includes(keyword)) {
        brandMismatch.push(`${brand.name} ("${keyword}") appears in the page but the host is ${pageDomain}`);
        break;
      }
    }
    if (brandMismatch.length) break;
  }
  out.push(
    finding(
      'deep-brand-mismatch',
      'Brand shown on an unrelated host',
      20,
      brandMismatch.length > 0,
      brandMismatch,
      'The page presents a protected brand while being served from a domain that brand does not own.',
      'identity',
    ),
  );

  const hiddenFrames: string[] = [];
  $('iframe').each((_, el) => {
    const style = ($(el).attr('style') ?? '').toLowerCase();
    const width = $(el).attr('width') ?? '';
    const height = $(el).attr('height') ?? '';
    const hidden =
      /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0/.test(style) ||
      width === '0' ||
      height === '0' ||
      $(el).attr('hidden') !== undefined;
    if (hidden) hiddenFrames.push($(el).attr('src') ?? '(no src)');
  });
  out.push(
    finding(
      'deep-hidden-iframe',
      'Hidden iframe',
      15,
      hiddenFrames.length > 0,
      hiddenFrames,
      'A zero-size or hidden iframe loads content the visitor cannot see, commonly a second stage or tracking payload.',
      'structure',
    ),
  );

  const refresh = $('meta[http-equiv]')
    .filter((_, el) => ($(el).attr('http-equiv') ?? '').toLowerCase() === 'refresh')
    .map((_, el) => $(el).attr('content') ?? '')
    .get();
  out.push(
    finding(
      'deep-meta-refresh',
      'Meta refresh redirect',
      10,
      refresh.length > 0,
      refresh,
      'A meta refresh bounces the visitor to another URL without any visible link.',
      'structure',
    ),
  );

  const scripts = $('script:not([src])')
    .map((_, el) => $(el).text())
    .get();
  const obfuscated = scripts.filter(
    (code) =>
      /eval\s*\(/.test(code) ||
      /unescape\s*\(/.test(code) ||
      /String\.fromCharCode/.test(code) ||
      /atob\s*\(/.test(code) ||
      /[A-Za-z0-9+/]{200,}={0,2}/.test(code),
  );
  out.push(
    finding(
      'deep-obfuscated-js',
      'Obfuscated inline script',
      15,
      obfuscated.length > 0,
      obfuscated.map((code) => code.slice(0, 80).replace(/\s+/g, ' ')),
      'Inline scripts using eval, unescape, fromCharCode or long base64 blobs hide what the page actually does.',
      'structure',
    ),
  );

  const icon = $('link[rel~="icon"], link[rel="shortcut icon"]').first().attr('href');
  const iconDomain = icon ? registrableOf(new URL(icon, finalUrl).href) : '';
  const crossIcon = Boolean(iconDomain && iconDomain !== pageDomain);
  out.push(
    finding(
      'deep-cross-favicon',
      'Favicon loaded from another domain',
      10,
      crossIcon,
      crossIcon ? [`${icon} -> ${iconDomain}`] : [],
      'Cloned pages often leave the original site favicon URL, which reveals the brand they copied.',
      'identity',
    ),
  );

  return out;
}

export async function deepScan(raw: string): Promise<DeepScanResult> {
  try {
    const page = await fetchPublicPage(raw);
    const host = new URL(page.finalUrl).hostname;
    if (!/html|text\/plain|xml/i.test(page.contentType) && page.contentType) {
      return {
        fetched: true,
        finalUrl: page.finalUrl,
        status: page.status,
        heuristics: [],
        checksRun: [],
        checksSkipped: [{ id: 'deep-html', reason: `Response is ${page.contentType}, not HTML; page checks were skipped.` }],
        note: `Fetched ${page.finalUrl} (${page.status}) but it is not HTML.`,
      };
    }
    return {
      fetched: true,
      finalUrl: page.finalUrl,
      status: page.status,
      heuristics: analyseHtml(page.body, page.finalUrl, host),
      checksRun: ['deep scan: fetched final page and analysed HTML statically'],
      checksSkipped: page.truncated
        ? [{ id: 'deep-truncated', reason: 'Page exceeded the 2 MB cap; only the first 2 MB was analysed.' }]
        : [],
      note: `Fetched ${page.finalUrl} (${page.status}) in ${page.hops.length} hop${page.hops.length === 1 ? '' : 's'}; ${page.body.length} bytes parsed. JavaScript was not executed.`,
    };
  } catch (error) {
    return {
      fetched: false,
      finalUrl: '',
      status: 0,
      heuristics: [],
      checksRun: [],
      checksSkipped: [{ id: 'deep-scan', reason: error instanceof Error ? error.message : 'Deep scan failed.' }],
      note: 'Deep scan did not run.',
    };
  }
}
