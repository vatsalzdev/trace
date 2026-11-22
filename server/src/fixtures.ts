import { createHash } from 'node:crypto';
import type { DnsInfo, RedirectHop, RegistrationInfo, TlsInfo } from '../../shared/types';

interface DomainFixture {
  registrar: string;
  ageDays: number;
  a: string[];
  mx?: string[];
  ns?: string[];
  issuer: string;
  status?: string[];
}

const FIXTURES: Record<string, DomainFixture> = {
  'sbi-kyc-verify.in': {
    registrar: 'NameCheap, Inc.',
    ageDays: 6,
    a: ['185.62.190.44'],
    mx: ['mail.sbi-kyc-verify.in'],
    ns: ['dns1.registrar-servers.com', 'dns2.registrar-servers.com'],
    issuer: "Let's Encrypt R3",
    status: ['clientTransferProhibited'],
  },
  'sbi-kyc-verify.example.com': {
    registrar: 'NameCheap, Inc.',
    ageDays: 4,
    a: ['185.62.190.44'],
    mx: ['mail.sbi-kyc-verify.example.com'],
    ns: ['dns1.registrar-servers.com'],
    issuer: "Let's Encrypt R3",
    status: ['clientTransferProhibited'],
  },
  'sbi-secure-login.xyz': {
    registrar: 'Hostinger Operations UAB',
    ageDays: 11,
    a: ['185.62.190.44'],
    ns: ['ns1.dns-parking.com'],
    issuer: "Let's Encrypt R3",
    status: ['clientTransferProhibited'],
  },
  'hdfc-kyc-update.top': {
    registrar: 'Alibaba Cloud Computing Ltd.',
    ageDays: 19,
    a: ['45.117.88.211'],
    ns: ['ns1.alidns.com'],
    issuer: 'ZeroSSL RSA Domain Secure Site CA',
    status: ['clientTransferProhibited', 'clientHold'],
  },
  'paytm-kyc.xyz': {
    registrar: 'GoDaddy.com, LLC',
    ageDays: 8,
    a: ['185.62.190.44'],
    ns: ['ns1.parklogic.com'],
    issuer: "Let's Encrypt R3",
  },
  'amazon-refund.top': {
    registrar: 'NameSilo, LLC',
    ageDays: 3,
    a: ['103.152.220.19'],
    ns: ['ns1.dnsowl.com'],
    issuer: 'ZeroSSL RSA Domain Secure Site CA',
  },
  'electricity-bill-pay.xyz': {
    registrar: 'NameCheap, Inc.',
    ageDays: 14,
    a: ['185.62.190.44'],
    ns: ['dns1.registrar-servers.com'],
    issuer: "Let's Encrypt R3",
  },
  'incometax-refund.top': {
    registrar: 'Dynadot LLC',
    ageDays: 9,
    a: ['45.117.88.211'],
    ns: ['ns1.dynadot.com'],
    issuer: "Let's Encrypt R3",
  },
  'parcel-clear.click': {
    registrar: 'GoDaddy.com, LLC',
    ageDays: 21,
    a: ['103.152.220.19'],
    ns: ['ns1.parklogic.com'],
    issuer: "Let's Encrypt R3",
  },
  'sbi.co.in': {
    registrar: 'Endurance Digital Domain Technology LLP',
    ageDays: 11800,
    a: ['103.87.201.10'],
    mx: ['mail.sbi.co.in'],
    ns: ['ns1.sbi.co.in'],
    issuer: 'DigiCert TLS RSA SHA256 2020 CA1',
  },
  'hdfcbank.com': {
    registrar: 'MarkMonitor Inc.',
    ageDays: 9200,
    a: ['104.18.24.15'],
    ns: ['ns1.markmonitor.com'],
    issuer: 'DigiCert TLS RSA SHA256 2020 CA1',
  },
  'bit.ly': {
    registrar: 'Bitly, Inc.',
    ageDays: 6100,
    a: ['67.199.248.11'],
    ns: ['ns1.bitly.com'],
    issuer: 'DigiCert TLS RSA SHA256 2020 CA1',
  },
};

const REGISTRARS = ['NameCheap, Inc.', 'GoDaddy.com, LLC', 'Hostinger Operations UAB', 'NameSilo, LLC', 'Dynadot LLC'];

function hashInt(value: string): number {
  const h = createHash('sha256').update(value).digest();
  return h.readUInt32BE(0);
}

export function fixtureFor(domain: string): DomainFixture {
  const known = FIXTURES[domain];
  if (known) return known;
  const seed = hashInt(domain);
  const age = 2 + (seed % 420);
  const octet = (seed >> 8) % 240;
  return {
    registrar: REGISTRARS[seed % REGISTRARS.length],
    ageDays: age,
    a: [`45.${octet}.${(seed >> 4) % 250}.${(seed >> 12) % 250}`],
    ns: [`ns1.${domain.split('.').slice(-2).join('.')}`],
    issuer: age < 30 ? "Let's Encrypt R3" : 'Sectigo RSA Domain Validation Secure Server CA',
  };
}

export function registrationFixture(domain: string): RegistrationInfo {
  const f = fixtureFor(domain);
  const created = new Date(Date.now() - f.ageDays * 86400000).toISOString();
  return {
    registrar: f.registrar,
    createdAt: created,
    ageDays: f.ageDays,
    status: f.status ?? ['clientTransferProhibited'],
    nameservers: f.ns ?? [],
  };
}

export function dnsFixture(domain: string): DnsInfo {
  const f = fixtureFor(domain);
  return { a: f.a, mx: f.mx ?? [], ns: f.ns ?? [] };
}

export function tlsFixture(domain: string): TlsInfo {
  const f = fixtureFor(domain);
  return {
    issuer: f.issuer,
    subject: `CN=${domain}`,
    validFrom: new Date(Date.now() - 12 * 86400000).toISOString(),
    validTo: new Date(Date.now() + 78 * 86400000).toISOString(),
  };
}

export function redirectFixture(start: string): RedirectHop[] {
  let host = '';
  try {
    host = new URL(start).hostname;
  } catch {
    host = start;
  }
  const f = fixtureFor(host);
  if (f.ageDays < 30 && /^https?:/i.test(start)) {
    const second = start.replace(/^http:/i, 'https:');
    const final = `${second.split('?')[0].replace(/\/$/, '')}/verify/session`;
    return [
      { url: start, status: 302, location: second },
      { url: second, status: 302, location: final },
      { url: final, status: 200 },
    ];
  }
  return [{ url: start, status: 200 }];
}
