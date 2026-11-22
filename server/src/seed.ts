import type { ApkAnalysis, EntityType, MessageAnalysis, UrlAnalysis } from '../../shared/types';
import { analyzeMessage } from '../../shared/message';
import { analyzeUrl } from '../../shared/url';
import { caseCount, db, nowIso, saveCase } from './db';
import { applyEnrichment } from './enrich';
import { dnsFixture, redirectFixture, registrationFixture, tlsFixture } from './fixtures';
import { buildSampleApk } from './sample-apk';
import { inspectApk } from './apk';

interface SeedDef {
  title: string;
  status: 'open' | 'investigating' | 'closed';
  daysAgo: number;
  hour: number;
  kind: 'message' | 'url' | 'apk';
  raw: string;
  notes: string;
}

const SEED: SeedDef[] = [
  {
    title: 'SBI KYC suspension — verification fee',
    status: 'closed',
    daysAgo: 44,
    hour: 10,
    kind: 'message',
    raw: 'URGENT! Your SBI account will be blocked today. Complete KYC immediately: http://sbi-kyc-verify.in/kyc Pay verification fee of Rs 99 to: kyc.support@fakebank Helpline +91 98123 45670',
    notes: 'Complainant is a 61-year-old retired teacher from Pune. ₹99 was debited; no larger loss. Number reported to 1930 on the same day.',
  },
  {
    title: 'SBI reward points expiry lure',
    status: 'closed',
    daysAgo: 41,
    hour: 16,
    kind: 'message',
    raw: 'Dear customer, your SBI Reward Points (4,820) expire today. Redeem at http://sbi-kyc-verify.in/rewards before 11:59 PM or they will be forfeited. For assistance pay Rs 10 verification to kyc.support@fakebank. Call 98123 45670',
    notes: 'Same UPI handle as TRC-0001. Reward-points pretext used to justify the small verification payment.',
  },
  {
    title: 'SBI YONO re-activation with KYC fee',
    status: 'investigating',
    daysAgo: 37,
    hour: 12,
    kind: 'message',
    raw: 'SBI YONO: Your account is suspended. Re-activate immediately at http://sbi-kyc-verify.in/yono. Verify KYC and pay Rs 49 to kyc.support@fakebank. Helpline +91 98123 45670',
    notes: 'Third case on kyc.support@fakebank. The YONO pretext is newer than the KYC one; same infrastructure, same phone number.',
  },
  {
    title: 'HDFC KYC update — account block threat',
    status: 'closed',
    daysAgo: 34,
    hour: 9,
    kind: 'message',
    raw: 'HDFC Bank: KYC update pending. Your account will be blocked today. Update at http://hdfc-kyc-update.top/verify and pay Rs 25 to hdfc.kyc@fakebank.',
    notes: 'Victim completed the form but stopped at payment. Domain registered 19 days before the message.',
  },
  {
    title: 'FedEx parcel held at customs',
    status: 'investigating',
    daysAgo: 31,
    hour: 14,
    kind: 'message',
    raw: 'Dear customer, your parcel from FedEx is held at customs due to illegal items. Clear within 24 hours or legal action will be taken. Pay customs fee Rs 1,499 at bit.ly/parcel-clear or UPI customs.clear@fakebank. Call +91 98765 43210.',
    notes: 'Shortener resolves to parcel-clear.click. Caller impersonated a customs officer and asked for a second payment.',
  },
  {
    title: 'Digital arrest — CBI money laundering threat',
    status: 'investigating',
    daysAgo: 28,
    hour: 20,
    kind: 'message',
    raw: 'This is the final warning from CBI. A money laundering FIR has been registered against your Aadhaar. Digital arrest will begin in 2 hours unless you share OTP for verification. Contact investigating officer at +91 90123 45678. Do not tell police.',
    notes: 'Victim kept on a 6-hour video call. No URL; the operation is voice-led. Phone number used across at least two complaints.',
  },
  {
    title: 'Instant loan app — sideloaded APK',
    status: 'open',
    daysAgo: 25,
    hour: 11,
    kind: 'message',
    raw: 'Your pre-approved loan of Rs 50,000 is ready. Download app now: http://sbi-kyc-verify.in/app/loan-update.apk Install the app and complete KYC to receive funds in 10 minutes. Support kyc.support@fakebank +91 98123 45670',
    notes: 'Victim installed the APK. Contacts and SMS were exfiltrated before the app was removed.',
  },
  {
    title: 'SBI secure-login typosquat',
    status: 'investigating',
    daysAgo: 21,
    hour: 15,
    kind: 'url',
    raw: 'http://sbi-secure-login.xyz/verify?acc=1',
    notes: 'Domain uses the SBI name plus two lure words. Certificate issued 9 days before first report.',
  },
  {
    title: 'HDFC verification portal clone',
    status: 'open',
    daysAgo: 18,
    hour: 13,
    kind: 'url',
    raw: 'http://hdfc-kyc-update.top/login',
    notes: 'Page clones the HDFC NetBanking login. Shared hosting with the SBI cluster.',
  },
  {
    title: 'Paytm KYC wallet takeover page',
    status: 'closed',
    daysAgo: 15,
    hour: 17,
    kind: 'url',
    raw: 'http://paytm-kyc.xyz/claim?wallet=active',
    notes: 'Hosted on the same /24 as sbi-kyc-verify.in. Wallet balance was drained in one transaction.',
  },
  {
    title: 'SBI KYC Update APK — banker trojan',
    status: 'investigating',
    daysAgo: 12,
    hour: 10,
    kind: 'apk',
    raw: 'SBI_KYC_Update_v2.4.1.apk',
    notes: 'Debug-signed repack. Embeds the same UPI handle and C2 domain as the SMS cluster. Accessibility service is named AccessibilityRelay.',
  },
  {
    title: 'Electricity bill disconnection notice',
    status: 'open',
    daysAgo: 9,
    hour: 18,
    kind: 'message',
    raw: 'Your electricity will be disconnected tonight because your last bill was not updated. Pay immediately at http://electricity-bill-pay.xyz/pay and send screenshot to +91 91234 56780. - Electricity Board',
    notes: 'Targets consumers during peak billing week. Payment page requests card details.',
  },
  {
    title: 'Income tax refund claim',
    status: 'open',
    daysAgo: 5,
    hour: 11,
    kind: 'message',
    raw: 'Income Tax Department: Your refund of Rs 15,490 is approved. Verify your account and claim within 24 hours at http://incometax-refund.top/refund. Processing fee Rs 199 payable to refund.tax@fakebank.',
    notes: 'Sent from a spoofed sender ID. Refund amount is chosen to look plausible against the victim’s bracket.',
  },
  {
    title: 'Genuine HDFC OTP — control sample',
    status: 'closed',
    daysAgo: 2,
    hour: 9,
    kind: 'message',
    raw: '123456 is your OTP for txn of Rs 500 at AMAZON. Do not share this OTP with anyone. -HDFC Bank',
    notes: 'Control sample retained to test false positives. Correctly scores LOW: a brand mention without a mismatched link is not evidence.',
  },
];

function isoDaysAgo(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function cachedUrlAnalysis(raw: string) {
  const base = analyzeUrl(raw);
  const domain = base.registrableDomain;
  const enrichment = {
    mode: 'cached' as const,
    redirects: redirectFixture(base.normalized),
    registration: registrationFixture(domain),
    dns: dnsFixture(domain),
    tls: tlsFixture(base.breakdown.host),
    note: 'Seeded from deterministic fixture set. Live lookups run on new analyses.',
  };
  return applyEnrichment(base, enrichment);
}

function messageEntities(result: MessageAnalysis) {
  return result.entities.map((e) => ({ type: e.type, value: e.normalized, note: e.note, suspicious: e.suspicious }));
}

function urlEntities(result: UrlAnalysis & { enrichment: { dns: { a: string[] } } }) {
  const list: { type: EntityType; value: string; note?: string }[] = [
    { type: 'domain', value: result.registrableDomain },
    { type: 'url', value: result.normalized },
  ];
  for (const ip of result.enrichment.dns.a) list.push({ type: 'ip', value: ip, note: 'A record' });
  return list;
}

function apkEntities(result: ApkAnalysis) {
  return result.indicators.map((i) => ({ type: i.type, value: i.normalized, note: i.source }));
}

export async function seed(): Promise<{ cases: number }> {
  const apkBuffer = await buildSampleApk();
  const apkResult = await inspectApk(apkBuffer, 'SBI_KYC_Update_v2.4.1.apk');

  for (const def of SEED) {
    const createdAt = isoDaysAgo(def.daysAgo, def.hour);
    if (def.kind === 'message') {
      const result = analyzeMessage(def.raw);
      saveCase({
        title: def.title,
        status: def.status,
        source_type: 'message',
        raw_input: def.raw,
        analysis: result,
        entities: messageEntities(result),
        notes: def.notes,
        createdAt,
      });
    } else if (def.kind === 'url') {
      const result = cachedUrlAnalysis(def.raw);
      saveCase({
        title: def.title,
        status: def.status,
        source_type: 'url',
        raw_input: def.raw,
        analysis: result,
        entities: urlEntities(result),
        notes: def.notes,
        createdAt,
      });
    } else {
      saveCase({
        title: def.title,
        status: def.status,
        source_type: 'apk',
        raw_input: def.raw,
        analysis: apkResult,
        entities: apkEntities(apkResult),
        notes: def.notes,
        createdAt,
        eventMessage: 'APK ingested and unpacked (AXML manifest decoded)',
      });
    }
  }

  // Additional investigative events so timelines read like real case work.
  const extra: [string, string, number][] = [
    ['viewed', 'Analyst opened case and confirmed UPI handle reuse', 20],
    ['entity', 'UPI kyc.support@fakebank linked to TRC cluster', 19],
    ['note', 'Requested CDR for +91 98123 45670 from operator', 17],
    ['report', 'Interim report shared with cyber cell supervisor', 10],
    ['status', 'Case marked investigating after second complaint', 8],
    ['note', 'Bank confirms no legitimate merchant uses this handle', 6],
  ];
  const ids = db.prepare('SELECT id FROM cases ORDER BY created_at ASC').all() as { id: string }[];
  extra.forEach(([type, message, days], i) => {
    const target = ids[Math.min(ids.length - 1, i * 2)];
    if (!target) return;
    db.prepare('INSERT INTO events (case_id, type, message, created_at) VALUES (?, ?, ?, ?)').run(
      target.id,
      type,
      message,
      isoDaysAgo(days, 12),
    );
  });

  return { cases: caseCount() };
}

export async function seedIfEmpty(): Promise<void> {
  if (caseCount() === 0) {
    const result = await seed();
    console.log(`[trace] seeded ${result.cases} cases at ${nowIso()}`);
  }
}
