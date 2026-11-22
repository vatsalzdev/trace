import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { DANGEROUS_PERMISSIONS, EMAIL_DOMAINS } from '../../shared/data';
import type { ApkAnalysis, ApkComponent, ApkIndicator, ApkPermission, EntityType, Rule } from '../../shared/types';
import { normalizeEntity } from '../../shared/message';
import { isIpHost, parseBreakdown, riskFromScore } from '../../shared/url';
import { decodeAxml, type AxmlNode } from './axml';

function arr<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function axmlToObject(node: AxmlNode): Record<string, any> {
  const obj: Record<string, any> = { ...node.attrs };
  for (const child of node.children) {
    if (!obj[child.name]) obj[child.name] = [];
    (obj[child.name] as unknown[]).push(axmlToObject(child));
  }
  return obj;
}

function attrName(node: Record<string, any> | undefined): string {
  if (!node) return '';
  return String(node['android:name'] ?? node.name ?? '');
}

const URL_RE = /https?:\/\/[^\s"'<>\\\u0000-\u001f]{4,}/gi;
const IP_RE = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?![\d.])/g;
const UPI_RE = /\b[a-z0-9][a-z0-9._-]{1,}@[a-z]{2,}\b/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}\b/gi;
const PHONE_RE = /(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const TG_RE = /(?:https?:\/\/)?t\.me\/[a-z0-9_]{4,}/gi;
const FIREBASE_RE = /\b[a-z0-9-]+\.(?:firebaseio\.com|firebaseapp\.com|web\.app)\b/gi;

function printableRuns(text: string): string[] {
  return text.match(/[ -~]{6,}/g) ?? [];
}

function cleanMatch(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, '').replace(/[.,;:'")\]}\\]+$/, '');
}

export async function inspectApk(buffer: Buffer, fileName = 'upload.apk'): Promise<ApkAnalysis> {
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const md5 = createHash('md5').update(buffer).digest('hex');
  const zip = await JSZip.loadAsync(buffer);

  const manifestEntry = zip.file('AndroidManifest.xml');
  if (!manifestEntry) throw new Error('AndroidManifest.xml not found — not a valid APK');
  const manifestBuffer = await manifestEntry.async('nodebuffer');
  const isBinary = manifestBuffer.length > 4 && manifestBuffer.readUInt16LE(0) === 0x0003;
  let manifest: Record<string, any>;
  let manifestFormat: 'axml' | 'xml' = 'xml';
  if (isBinary) {
    manifest = axmlToObject(decodeAxml(manifestBuffer));
    manifestFormat = 'axml';
  } else {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      isArray: (name) => ['uses-permission', 'uses-permission-sdk-23', 'activity', 'service', 'receiver', 'provider', 'intent-filter', 'action', 'category'].includes(name),
    });
    const parsed = parser.parse(manifestBuffer.toString('utf8'));
    manifest = parsed.manifest ?? parsed;
  }

  const application = arr<Record<string, any>>(manifest.application)[0] ?? {};
  const usesSdk = arr<Record<string, any>>(manifest['uses-sdk'])[0] ?? {};
  const packageName = String(manifest.package ?? 'unknown.package');
  const versionName = String(manifest['android:versionName'] ?? 'unknown');
  const versionCode = String(manifest['android:versionCode'] ?? '0');
  const minSdk = String(usesSdk['android:minSdkVersion'] ?? manifest['android:minSdkVersion'] ?? 'unknown');
  const targetSdk = String(usesSdk['android:targetSdkVersion'] ?? manifest['android:targetSdkVersion'] ?? 'unknown');
  const appLabel = String(application['android:label'] ?? packageName);
  const debuggable = String(application['android:debuggable'] ?? 'false') === 'true';

  const declaredPermissions = [
    ...arr<Record<string, any>>(manifest['uses-permission']),
    ...arr<Record<string, any>>(manifest['uses-permission-sdk-23']),
  ]
    .map(attrName)
    .filter(Boolean);

  const permissions: ApkPermission[] = declaredPermissions.map((name) => {
    const known = DANGEROUS_PERMISSIONS.find((p) => p.name === name);
    return {
      name,
      short: known?.short ?? name.split('.').pop() ?? name,
      dangerous: Boolean(known),
      weight: known?.weight ?? 0,
      reason: known?.reason ?? 'No elevated capability in the TRACE permission rule set.',
    };
  });
  const permShort = new Set(permissions.map((p) => p.short));

  const components: ApkComponent[] = [];
  for (const type of ['activity', 'service', 'receiver', 'provider'] as const) {
    for (const c of arr<Record<string, any>>(application[type])) {
      const filters = arr<Record<string, any>>(c['intent-filter']).map((f) => {
        const actions = arr<Record<string, any>>(f.action).map(attrName).filter(Boolean);
        const categories = arr<Record<string, any>>(f.category).map(attrName).filter(Boolean);
        return [...actions, ...categories].join(' | ');
      });
      const exportedRaw = c['android:exported'];
      const exported = exportedRaw !== undefined ? String(exportedRaw) === 'true' : filters.length > 0;
      components.push({
        type,
        name: attrName(c) || '(unnamed)',
        exported,
        intentFilters: filters.filter(Boolean),
      });
    }
  }

  const indicators: ApkIndicator[] = [];
  const seen = new Set<string>();
  const addIndicator = (type: EntityType, rawValue: string, source: string) => {
    const value = cleanMatch(rawValue.trim());
    if (!value || value.length < 3) return;
    const normalized = normalizeEntity(type, value);
    const key = `${type}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    indicators.push({ type, value, normalized, source, start: 0, end: value.length });
  };

  const scanFiles = Object.keys(zip.files).filter(
    (name) => !zip.files[name].dir && /^(classes.*\.dex|resources\.arsc|assets\/|res\/|lib\/)/i.test(name),
  );
  for (const name of scanFiles) {
    const entry = zip.file(name);
    if (!entry) continue;
    const data = await entry.async('nodebuffer');
    if (data.length > 8_000_000) continue;
    const text = data.toString('latin1');
    for (const run of printableRuns(text)) {
      for (const match of run.matchAll(URL_RE)) {
        const before = run[(match.index ?? 0) - 1] ?? '';
        if (before === '@') continue;
        const value = cleanMatch(match[0]);
        addIndicator('url', value, name);
        try {
          const host = parseBreakdown(value).url.hostname;
          if (host) {
            const { registrable } = parseBreakdown(value);
            if (!isIpHost(host)) addIndicator('domain', registrable || host, name);
            else addIndicator('ip', host, name);
          }
        } catch {
          /* ignore malformed */
        }
      }
      for (const m of run.match(TG_RE) ?? []) {
        addIndicator('url', m.startsWith('http') ? m : `https://${m}`, name);
        addIndicator('domain', 't.me', name);
      }
      for (const m of run.match(IP_RE) ?? []) {
        const ip = m.split(':')[0];
        const octets = ip.split('.').map(Number);
        if (octets.every((o) => o >= 0 && o <= 255)) addIndicator('ip', ip, name);
      }
      for (const match of run.matchAll(UPI_RE)) {
        const value = match[0];
        const handle = value.split('@')[1]?.toLowerCase() ?? '';
        const tail = run.slice((match.index ?? 0) + value.length);
        if (EMAIL_DOMAINS.has(handle)) continue;
        if (handle.includes('-') || /^[.-][a-z0-9-]*\.[a-z]{2,}/i.test(tail)) continue;
        addIndicator('upi', value, name);
      }
      for (const m of run.match(EMAIL_RE) ?? []) addIndicator('email', m, name);
      for (const m of run.match(PHONE_RE) ?? []) addIndicator('phone', m, name);
      for (const m of run.match(FIREBASE_RE) ?? []) addIndicator('domain', m, name);
    }
  }

  addIndicator('package', packageName, 'AndroidManifest.xml');
  addIndicator('apk_hash', sha256, 'file');

  const certFiles = Object.keys(zip.files).filter((n) => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(n));
  const certificate = {
    present: certFiles.length > 0,
    files: certFiles,
    debugSigned: debuggable || certFiles.some((f) => /ANDROIDD\.(RSA|DSA|EC)$/i.test(f)),
  };

  const has = (short: string) => permShort.has(short);
  const bankerCombo = has('READ_SMS') && has('OVERLAY') && has('ACCESSIBILITY');
  const httpC2 = indicators.filter((i) => i.type === 'url' && i.value.toLowerCase().startsWith('http://'));
  const upiIndicators = indicators.filter((i) => i.type === 'upi');
  const telegram = indicators.filter((i) => i.type === 'url' && /t\.me\//i.test(i.value));
  const exported = components.filter((c) => c.exported);

  const rules: Rule[] = [
    {
      id: 'banker-combo',
      name: 'Banker-trojan capability pattern',
      weight: 30,
      triggered: bankerCombo,
      evidence: bankerCombo
        ? ['READ_SMS + SYSTEM_ALERT_WINDOW + BIND_ACCESSIBILITY_SERVICE declared together', 'this triad can read OTPs, overlay a fake bank screen and auto-click consent']
        : [],
      explanation: 'Reading SMS, drawing overlays and abusing accessibility together is the canonical Android banking-trojan capability set. Each alone has legitimate uses; together they do not.',
      category: 'capability',
    },
    {
      id: 'sms-intercept',
      name: 'SMS interception',
      weight: 15,
      triggered: has('READ_SMS') || has('RECEIVE_SMS'),
      evidence: permissions.filter((p) => p.short === 'READ_SMS' || p.short === 'RECEIVE_SMS').map((p) => `${p.name} declared`),
      explanation: 'SMS access lets the package read or intercept OTPs, the second factor protecting Indian bank accounts.',
      category: 'capability',
    },
    {
      id: 'overlay',
      name: 'Screen overlay injection',
      weight: 15,
      triggered: has('OVERLAY'),
      evidence: has('OVERLAY') ? ['android.permission.SYSTEM_ALERT_WINDOW declared'] : [],
      explanation: 'Overlay permission lets the app draw over banking apps and capture credentials on a pixel-perfect fake screen.',
      category: 'capability',
    },
    {
      id: 'accessibility',
      name: 'Accessibility service abuse',
      weight: 20,
      triggered: has('ACCESSIBILITY') || components.some((c) => /Accessibility/i.test(c.name)),
      evidence: [
        ...(has('ACCESSIBILITY') ? ['android.permission.BIND_ACCESSIBILITY_SERVICE declared'] : []),
        ...components.filter((c) => /Accessibility/i.test(c.name)).map((c) => `${c.type} ${c.name}`),
      ],
      explanation: 'Accessibility access can read every screen and perform taps on the user’s behalf, defeating most in-app protections.',
      category: 'capability',
    },
    {
      id: 'install-packages',
      name: 'Second-stage install capability',
      weight: 10,
      triggered: has('INSTALL_PACKAGES'),
      evidence: has('INSTALL_PACKAGES') ? ['android.permission.REQUEST_INSTALL_PACKAGES declared'] : [],
      explanation: 'The package can drop and prompt installation of additional payloads after the first install.',
      category: 'capability',
    },
    {
      id: 'device-admin',
      name: 'Device administration',
      weight: 10,
      triggered: has('DEVICE_ADMIN'),
      evidence: has('DEVICE_ADMIN') ? ['android.permission.BIND_DEVICE_ADMIN declared'] : [],
      explanation: 'Device-admin rights can resist uninstall and lock the device after a fraudulent transfer.',
      category: 'capability',
    },
    {
      id: 'contact-harvest',
      name: 'Contact and call-log harvesting',
      weight: 8,
      triggered: has('READ_CONTACTS') || has('READ_CALL_LOG'),
      evidence: permissions.filter((p) => ['READ_CONTACTS', 'READ_CALL_LOG'].includes(p.short)).map((p) => `${p.name} declared`),
      explanation: 'Contact and call-log access is used to map the victim’s network and seed further smishing.',
      category: 'collection',
    },
    {
      id: 'query-packages',
      name: 'Banking-app enumeration',
      weight: 8,
      triggered: has('QUERY_PACKAGES'),
      evidence: has('QUERY_PACKAGES') ? ['android.permission.QUERY_ALL_PACKAGES declared'] : [],
      explanation: 'Querying every installed package lets the malware detect and target specific banking and UPI apps.',
      category: 'collection',
    },
    {
      id: 'debug-signed',
      name: 'Debug-signed build',
      weight: 12,
      triggered: certificate.debugSigned,
      evidence: certificate.debugSigned
        ? [debuggable ? 'android:debuggable="true" in manifest' : '', ...certFiles.filter((f) => /ANDROIDD/i.test(f))]
        : [],
      explanation: 'Production banking software is never debug-signed; this build was assembled for testing or rapid redeployment.',
      category: 'provenance',
    },
    {
      id: 'no-cert',
      name: 'No signing certificate',
      weight: 15,
      triggered: !certificate.present,
      evidence: certificate.present ? [] : ['no META-INF/*.RSA|DSA|EC entry found'],
      explanation: 'An unsigned package cannot be traced to a publisher and may have been repacked after tampering.',
      category: 'provenance',
    },
    {
      id: 'http-c2',
      name: 'Cleartext command-and-control endpoint',
      weight: 10,
      triggered: httpC2.length > 0,
      evidence: httpC2.slice(0, 3).map((i) => `${i.value} (${i.source})`),
      explanation: 'C2 traffic over plain HTTP is trivially interceptable and is not used by legitimate financial apps.',
      category: 'network',
    },
    {
      id: 'upi-collection',
      name: 'Embedded payment identifier',
      weight: 10,
      triggered: upiIndicators.length > 0,
      evidence: upiIndicators.slice(0, 3).map((i) => `${i.value} (${i.source})`),
      explanation: 'A UPI handle embedded in the package gives the operator a direct collection route for stolen funds.',
      category: 'financial',
    },
    {
      id: 'telegram',
      name: 'Operator Telegram channel',
      weight: 8,
      triggered: telegram.length > 0,
      evidence: telegram.slice(0, 3).map((i) => `${i.value} (${i.source})`),
      explanation: 'Telegram links are used for exfiltration and operator coordination; consumer banking apps do not embed them.',
      category: 'network',
    },
    {
      id: 'exported-components',
      name: 'Exported attack surface',
      weight: 5,
      triggered: exported.length >= 2,
      evidence: exported.slice(0, 4).map((c) => `${c.type} ${c.name} is exported`),
      explanation: 'Multiple exported components widen the attack surface and allow other apps to invoke sensitive flows.',
      category: 'surface',
    },
    {
      id: 'cleartext',
      name: 'Cleartext traffic permitted',
      weight: 5,
      triggered: String(application['android:usesCleartextTraffic'] ?? 'false') === 'true',
      evidence: String(application['android:usesCleartextTraffic'] ?? 'false') === 'true' ? ['android:usesCleartextTraffic="true"'] : [],
      explanation: 'Allowing cleartext traffic lets the app talk to unencrypted endpoints, consistent with the HTTP C2 indicators.',
      category: 'network',
    },
  ];

  const triggered = rules.filter((r) => r.triggered);
  const score = Math.min(100, triggered.reduce((sum, r) => sum + r.weight, 0));
  const riskLabel = riskFromScore(score);

  const summary =
    triggered.length === 0
      ? 'No dangerous permission combinations, embedded payment routes or suspicious endpoints were found. This does not certify the app — it means the TRACE rule set found no signal.'
      : `This package requests ${permissions.filter((p) => p.dangerous).length} dangerous permissions and triggers ${triggered.length} rules for a score of ${score}/100. ${
          bankerCombo ? 'It declares the SMS + overlay + accessibility triad used by Android banking trojans. ' : ''
        }${httpC2.length ? `It contacts cleartext endpoint ${httpC2[0].value}. ` : ''}${
          upiIndicators.length ? `It embeds payment handle ${upiIndicators[0].value}. ` : ''
        }${certificate.debugSigned ? 'The build is debug-signed, not a production release.' : ''}`;

  return {
    fileName,
    fileSize: buffer.length,
    sha256,
    md5,
    packageName,
    versionName,
    versionCode,
    minSdk,
    targetSdk,
    appLabel,
    permissions,
    components,
    indicators,
    rules,
    score,
    riskLabel,
    hashes: { sha256, md5 },
    certificate,
    manifestFormat,
    summary,
  };
}
