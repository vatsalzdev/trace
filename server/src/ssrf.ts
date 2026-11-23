import { promises as dns } from 'node:dns';
import net from 'node:net';

const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const USER_AGENT = 'TRACE-DeepScan/1.0 (static analysis; no JavaScript)';

const BLOCKED_V4: Array<[number, number]> = [
  [0x7f000000, 8], // 127/8 loopback
  [0x0a000000, 8], // 10/8 private
  [0xac100000, 12], // 172.16/12 private
  [0xc0a80000, 16], // 192.168/16 private
  [0xa9fe0000, 16], // 169.254/16 link-local + metadata
  [0x64400000, 10], // 100.64/10 CGNAT
  [0x00000000, 8], // 0/8
  [0xc0000000, 24], // 192.0.0/24
  [0xc0000200, 24], // 192.0.2/24 documentation
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xe0000000, 4], // 224/4 multicast
  [0xf0000000, 4], // 240/4 reserved
];

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function inV4Range(value: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return BLOCKED_V4.some(([base, bits]) => inV4Range(value, base, bits));
}

function expandIpv6(ip: string): string[] | null {
  const clean = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = clean.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return ['::ffff:' + mapped[1]];
  if (!net.isIPv6(clean)) return null;
  const [head, tail] = clean.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  return [...headParts, ...Array(missing).fill('0'), ...tailParts];
}

export function isPrivateIpv6(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const mapped = clean.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const groups = expandIpv6(clean);
  if (!groups) return false;
  const first = parseInt(groups[0], 16);
  // ::1 loopback, :: unspecified
  if (groups.every((g) => parseInt(g, 16) === 0)) return true;
  if (groups.slice(0, 7).every((g) => parseInt(g, 16) === 0) && parseInt(groups[7], 16) === 1) return true;
  // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return false;
}

export interface GuardedTarget {
  url: URL;
  addresses: string[];
}

/**
 * Resolve and vet a URL before any request. Every redirect hop must call this
 * again so a public host cannot rebound to a private address mid-chain.
 */
export async function assertPublicUrl(raw: string): Promise<GuardedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Deep scan refused: not a valid absolute URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Deep scan refused: scheme "${url.protocol}" is not allowed.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('Deep scan refused: URL has no host.');
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`Deep scan refused: ${host} is a private, loopback or reserved address.`);
    return { url, addresses: [host] };
  }
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`Deep scan refused: DNS lookup for ${host} failed.`);
  }
  if (!records.length) throw new Error(`Deep scan refused: ${host} has no DNS records.`);
  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error(`Deep scan refused: ${host} resolves to private address ${record.address}.`);
    }
  }
  return { url, addresses: records.map((r) => r.address) };
}

export interface FetchedPage {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
  hops: string[];
}

async function readCapped(res: Response): Promise<{ body: string; truncated: boolean }> {
  if (!res.body) return { body: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      chunks.push(value.slice(0, Math.max(0, MAX_BYTES - (total - value.byteLength))));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks).toString('utf8'), truncated };
}

/** Fetch a public page with the SSRF guard, redirect re-validation and a byte cap. */
export async function fetchPublicPage(raw: string): Promise<FetchedPage> {
  let current = (await assertPublicUrl(raw)).url;
  const hops: string[] = [current.href];
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      });
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new Error(`Deep scan timed out after ${TIMEOUT_MS / 1000}s.`);
      throw new Error(`Deep scan fetch failed: ${error instanceof Error ? error.message : 'network error'}`);
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error(`Deep scan stopped: ${res.status} redirect without a Location header.`);
      if (redirects === MAX_REDIRECTS) throw new Error(`Deep scan stopped: more than ${MAX_REDIRECTS} redirects.`);
      const next = new URL(location, current);
      const guarded = await assertPublicUrl(next.href);
      current = guarded.url;
      hops.push(current.href);
      continue;
    }

    const { body, truncated } = await readCapped(res);
    return {
      finalUrl: current.href,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body,
      truncated,
      hops,
    };
  }
  throw new Error(`Deep scan stopped: more than ${MAX_REDIRECTS} redirects.`);
}
