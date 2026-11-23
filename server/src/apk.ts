import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import forge from 'node-forge';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import officialAppsJson from '../../data/official-apps.json';
import { DANGEROUS_PERMISSIONS, EMAIL_DOMAINS, URL_SHORTENERS } from '../../shared/data';
import type {
  ApkAnalysis,
  ApkCapability,
  ApkCertificate,
  ApkComponent,
  ApkDexFile,
  ApkIndicator,
  ApkPermission,
  CoverageCheck,
  EntityType,
  NestedFile,
  Rule,
} from '../../shared/types';
import { normalizeEntity } from '../../shared/message';
import { isIpHost, parseBreakdown, riskFromScore } from '../../shared/url';
import { computeVerdict, rulesToFindings } from '../../shared/verdict';
import { decodeAxml, type AxmlNode } from './axml';
import { dexPrintableRuns, parseDex, type DexInfo, type DexMethod } from './dex';

const here = dirname(fileURLToPath(import.meta.url));

function loadKnownBadHashes(): Set<string> {
  try {
    return new Set(
      readFileSync(join(here, '..', '..', 'data', 'known-bad-hashes.txt'), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => /^[a-f0-9]{64}$/.test(line)),
    );
  } catch {
    return new Set();
  }
}

const KNOWN_BAD_HASHES = loadKnownBadHashes();
const REPUTATION_ENABLED = process.env.TRACE_ENABLE_REPUTATION === '1';
const VT_KEY = REPUTATION_ENABLED ? process.env.VT_API_KEY?.trim() ?? '' : '';
const vtCache = new Map<string, { at: number; hits: number; skipped?: CoverageCheck }>();

interface OfficialApp {
  brand: string;
  keywords: string[];
  packages: string[];
}
const OFFICIAL_APPS = officialAppsJson as OfficialApp[];

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
const BASE64_BLOB_RE = /[A-Za-z0-9+/]{120,}={0,2}/g;

const PACKER_LIBS = ['libjiagu', 'libsecexe', 'libdexprotector', 'libapp-protect', 'libmobisec', 'libnesec', 'libexec.so'];

function printableRuns(text: string): string[] {
  return text.match(/[ -~]{6,}/g) ?? [];
}

function cleanMatch(value: string): string {
  return value.replace(/[\u0000-\u001f]/g, '').replace(/[.,;:'")\]}\\]+$/, '');
}

function rule(id: string, name: string, weight: number, triggered: boolean, evidence: string[], explanation: string, category: string): Rule {
  return { id, name, weight, triggered, evidence: triggered ? [...new Set(evidence)].slice(0, 6) : [], explanation, category };
}

function nameMatches(method: DexMethod, name: string): boolean {
  return method.name === name;
}

function fingerprintOf(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const hex = forge.md.sha256.create().update(der).digest().toHex().toUpperCase();
  return hex.match(/.{2}/g)?.join(':') ?? hex;
}

function dnOf(attributes: any[]): string {
  return attributes.map((a) => `${a.shortName ?? a.type}=${a.value}`).join(', ');
}

function parseSigningCertificate(files: string[], buffers: Map<string, Buffer>): ApkCertificate {
  const anomalies: string[] = [];
  const result: ApkCertificate = { present: files.length > 0, files, debugSigned: false, anomalies };
  for (const name of files) {
    const data = buffers.get(name);
    if (!data) continue;
    try {
      const asn1 = forge.asn1.fromDer(forge.util.createBuffer(data.toString('binary')));
      const p7 = forge.pkcs7.messageFromAsn1(asn1);
      const cert = (p7 as unknown as { certificates?: forge.pki.Certificate[] }).certificates?.[0];
      if (!cert) {
        anomalies.push(`${name}: no certificate inside PKCS#7`);
        continue;
      }
      const subject = dnOf(cert.subject.attributes);
      const issuer = dnOf(cert.issuer.attributes);
      const validFrom = cert.validity.notBefore.toISOString();
      const validTo = cert.validity.notAfter.toISOString();
      const years = (cert.validity.notAfter.getTime() - cert.validity.notBefore.getTime()) / (365.25 * 24 * 3600 * 1000);
      result.subject = subject;
      result.issuer = issuer;
      result.validFrom = validFrom;
      result.validTo = validTo;
      result.selfSigned = subject === issuer;
      result.sha256Fingerprint = fingerprintOf(cert);
      result.debugSigned = /android debug/i.test(`${subject} ${issuer}`) || files.some((f) => /ANDROIDD\.(RSA|DSA|EC)$/i.test(f));
      if (years >= 30) result.longValidity = true;
      break;
    } catch (error) {
      anomalies.push(`${name}: ${error instanceof Error ? error.message : 'could not parse PKCS#7'}`);
    }
  }
  if (files.length && !result.subject) {
    result.debugSigned = files.some((f) => /ANDROIDD\.(RSA|DSA|EC)$/i.test(f));
  }
  return result;
}

async function virusTotalHash(sha256: string): Promise<{ hits: number; skipped?: CoverageCheck }> {
  const cached = vtCache.get(sha256);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return { hits: cached.hits, skipped: cached.skipped };
  if (!VT_KEY) return { hits: 0, skipped: { id: 'reputation-hash', reason: 'VT_API_KEY is not set; no hash reputation lookup was made.' } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, {
      signal: controller.signal,
      headers: { 'x-apikey': VT_KEY },
    });
    if (!res.ok) {
      const skipped = { id: 'reputation-hash', reason: `VirusTotal hash lookup returned ${res.status}.` };
      vtCache.set(sha256, { at: Date.now(), hits: 0, skipped });
      return { hits: 0, skipped };
    }
    const body = (await res.json()) as { data?: { attributes?: { last_analysis_stats?: { malicious?: number; suspicious?: number } } } };
    const hits = (body.data?.attributes?.last_analysis_stats?.malicious ?? 0) + (body.data?.attributes?.last_analysis_stats?.suspicious ?? 0);
    vtCache.set(sha256, { at: Date.now(), hits });
    return { hits };
  } catch (error) {
    const skipped = { id: 'reputation-hash', reason: `VirusTotal hash lookup failed: ${error instanceof Error ? error.message : 'network error'}.` };
    vtCache.set(sha256, { at: Date.now(), hits: 0, skipped });
    return { hits: 0, skipped };
  } finally {
    clearTimeout(timer);
  }
}

function inconclusiveApk(buffer: Buffer, fileName: string, sha256: string, md5: string, reason: string): ApkAnalysis {
  const verdict = computeVerdict({
    score: 0,
    findings: [],
    coverage: { checksRun: [], checksSkipped: [{ id: 'manifest', reason }] },
    analysisFailed: true,
  });
  return {
    fileName,
    fileSize: buffer.length,
    sha256,
    md5,
    packageName: 'unknown.package',
    versionName: 'unknown',
    versionCode: '0',
    minSdk: 'unknown',
    targetSdk: 'unknown',
    appLabel: 'unknown',
    permissions: [],
    components: [],
    indicators: [],
    rules: [],
    score: 0,
    riskLabel: 'LOW',
    hashes: { sha256, md5 },
    certificate: { present: false, files: [], debugSigned: false, anomalies: [] },
    manifestFormat: 'xml',
    summary: `TRACE could not read this package: ${reason}`,
    verdict,
    nestedFiles: [],
    dexFiles: [],
    packed: false,
    capabilities: [],
  };
}

export async function inspectApk(buffer: Buffer, fileName = 'upload.apk'): Promise<ApkAnalysis> {
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const md5 = createHash('md5').update(buffer).digest('hex');
  const zip = await JSZip.loadAsync(buffer);

  const manifestEntry = zip.file('AndroidManifest.xml');
  if (!manifestEntry) {
    return inconclusiveApk(buffer, fileName, sha256, md5, 'AndroidManifest.xml is missing from the APK root, so package identity and permissions cannot be read.');
  }
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
  const applicationClass = String(application['android:name'] ?? '');

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
  const has = (short: string) => permShort.has(short);

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
  const hasLauncher = components.some((c) => c.intentFilters.some((f) => /LAUNCHER/i.test(f)));

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

  const fileNames = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const dexEntries = fileNames.filter((name) => /^classes.*\.dex$/i.test(name));
  const nestedFiles: NestedFile[] = [];
  const dexFiles: ApkDexFile[] = [];
  const dexStrings: string[] = [];
  const dexMethods: DexMethod[] = [];
  let dexTruncated = false;

  for (const name of dexEntries) {
    const entry = zip.file(name);
    if (!entry) continue;
    const data = await entry.async('nodebuffer');
    const info: DexInfo = parseDex(data);
    dexFiles.push({
      name,
      size: data.length,
      strings: info.strings.length,
      methods: info.methods.length,
      truncated: info.truncated,
      error: info.error,
    });
    if (info.truncated || info.error) dexTruncated = true;
    dexStrings.push(...info.strings);
    dexMethods.push(...info.methods);
    dexStrings.push(...dexPrintableRuns(data));
  }

  // Inventory nested code containers and native libraries.
  for (const name of fileNames) {
    const match = name.match(/\.(apk|dex|jar|so)$/i);
    if (!match) continue;
    const kind = match[1].toLowerCase() as NestedFile['kind'];
    const insidePayload = /^(assets|res\/raw)\//i.test(name);
    const isDexRoot = /^classes.*\.dex$/i.test(name);
    const isLib = /^lib\//i.test(name);
    if (isDexRoot || (isLib && kind === 'so')) {
      if (isLib) {
        const data = await zip.file(name)!.async('nodebuffer');
        nestedFiles.push({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), kind });
      }
      continue;
    }
    if (!insidePayload) continue;
    const data = await zip.file(name)!.async('nodebuffer');
    nestedFiles.push({ name, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), kind });
  }

  const scanFiles = fileNames.filter(
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

  const certFiles = fileNames.filter((n) => /^META-INF\/.*\.(RSA|DSA|EC)$/i.test(n));
  const certBuffers = new Map<string, Buffer>();
  for (const name of certFiles) certBuffers.set(name, await zip.file(name)!.async('nodebuffer'));
  const certificate = parseSigningCertificate(certFiles, certBuffers);
  if (debuggable) certificate.debugSigned = true;

  /* --------------------------- behaviour signals --------------------------- */
  const strings = dexStrings;
  const stringBlob = strings.join('\n');
  const methodNames = new Set(dexMethods.map((m) => m.name));
  const smsSendMethods = ['sendTextMessage', 'sendMultipartTextMessage', 'sendDataMessage'];
  const hasSmsSendApi = smsSendMethods.some((name) => methodNames.has(name) || stringBlob.includes(name));
  const hasSmsReadApi =
    /content:\/\/sms|Telephony\.Sms|SMS_RECEIVED|abortBroadcast|sms\/inbox/i.test(stringBlob) ||
    methodNames.has('abortBroadcast') ||
    has('READ_SMS') ||
    has('RECEIVE_SMS');
  const dynamicApis = ['DexClassLoader', 'PathClassLoader', 'exec', 'loadLibrary'];
  const dynamicEvidence = [
    ...dynamicApis.filter((name) => methodNames.has(name) || stringBlob.includes(name)).map((name) => `references ${name}`),
    ...(stringBlob.match(/Runtime\.getRuntime\(\)\.exec/g) ?? []).map(() => 'Runtime.exec()'),
  ];
  const dynamicCode = dynamicEvidence.length > 0;
  const reflectionCount =
    (methodNames.has('forName') ? 1 : 0) + (methodNames.has('getMethod') ? 1 : 0) + (methodNames.has('getDeclaredMethod') ? 1 : 0);
  const reflection = reflectionCount >= 2;
  const base64Blobs = stringBlob.match(BASE64_BLOB_RE) ?? [];
  const deviceAdminApi = /lockNow|resetPassword|DevicePolicyManager/i.test(stringBlob) || methodNames.has('lockNow');
  const overlayApi = /TYPE_APPLICATION_OVERLAY|TYPE_SYSTEM_ALERT|addView/i.test(stringBlob) || methodNames.has('addView');
  const notificationListener = /NotificationListenerService|onNotificationPosted/i.test(stringBlob);
  const usageStats = /UsageStatsManager|queryUsageStats/i.test(stringBlob);
  const telegramBot = /api\.telegram\.org\/bot/i.test(stringBlob);
  const pasteHosts = /pastebin\.com|raw\.githubusercontent\.com|transfer\.sh|ghostbin|hastebin/i.test(stringBlob);
  const shortenerHit = [...URL_SHORTENERS].find((host) => stringBlob.includes(host)) ?? '';
  const hardcodedIps = indicators.filter((i) => i.type === 'ip');
  const nonstandardPort = indicators.some((i) => i.type === 'url' && /:\d{2,5}\//.test(i.value) && !/:(80|443)\//.test(i.value));
  const firebaseHit = indicators.some((i) => i.type === 'domain' && /firebaseio|firebaseapp|web\.app/i.test(i.value));
  const httpC2 = indicators.filter((i) => i.type === 'url' && i.value.toLowerCase().startsWith('http://'));
  const upiIndicators = indicators.filter((i) => i.type === 'upi');
  const telegram = indicators.filter((i) => i.type === 'url' && /t\.me\//i.test(i.value));
  const exported = components.filter((c) => c.exported);

  const packerLibs = nestedFiles.filter((f) => f.kind === 'so' && PACKER_LIBS.some((lib) => f.name.toLowerCase().includes(lib)));
  const classNames = new Set(dexFiles.length ? dexMethods.map((m) => m.className) : []);
  const shortNameRatio = (() => {
    const names = [...classNames, ...dexMethods.map((m) => m.name)].filter(Boolean);
    if (names.length < 40) return 0;
    const short = names.filter((name) => name.replace(/^.*\//, '').length <= 2).length;
    return short / names.length;
  })();
  const largeAssets = nestedFiles.filter((f) => /^assets\//i.test(f.name) && f.size > 500_000);
  const dexTotal = dexFiles.reduce((sum, f) => sum + f.size, 0);
  const missingApplicationClass =
    Boolean(applicationClass) && dexMethods.length > 0 && ![...classNames].some((name) => name.endsWith(applicationClass.replace(/^\./, '')));
  const packed =
    packerLibs.length > 0 ||
    shortNameRatio > 0.5 ||
    (dexFiles.length > 0 && dexTotal < 10_000 && largeAssets.length > 0) ||
    missingApplicationClass;

  /* ------------------------------ impersonation ----------------------------- */
  const labelAndPackage = `${appLabel} ${packageName}`.toLowerCase();
  const impersonation = OFFICIAL_APPS.find(
    (entry) =>
      entry.keywords.some((keyword) => labelAndPackage.includes(keyword)) &&
      !entry.packages.some((pkg) => packageName === pkg),
  );

  const capabilities: ApkCapability[] = [
    { id: 'sms', label: 'SMS send / read', triggered: hasSmsSendApi || hasSmsReadApi, evidence: [hasSmsSendApi ? 'SMS send API referenced' : '', hasSmsReadApi ? 'SMS read/intercept referenced' : ''].filter(Boolean) },
    { id: 'overlay', label: 'Screen overlay', triggered: has('OVERLAY') || overlayApi, evidence: has('OVERLAY') ? ['SYSTEM_ALERT_WINDOW'] : overlayApi ? ['overlay view API referenced'] : [] },
    { id: 'accessibility', label: 'Accessibility', triggered: has('ACCESSIBILITY') || components.some((c) => /Accessibility/i.test(c.name)), evidence: has('ACCESSIBILITY') ? ['BIND_ACCESSIBILITY_SERVICE'] : components.filter((c) => /Accessibility/i.test(c.name)).map((c) => c.name) },
    { id: 'dynamic-code', label: 'Dynamic code loading', triggered: dynamicCode, evidence: dynamicEvidence },
    { id: 'network', label: 'Network exfiltration', triggered: httpC2.length > 0 || telegram.length > 0 || hardcodedIps.length > 0 || telegramBot, evidence: [...httpC2.slice(0, 2).map((i) => i.value), ...telegram.slice(0, 2).map((i) => i.value), ...hardcodedIps.slice(0, 2).map((i) => i.value)] },
    { id: 'device-admin', label: 'Device admin', triggered: has('DEVICE_ADMIN') || deviceAdminApi, evidence: [has('DEVICE_ADMIN') ? 'BIND_DEVICE_ADMIN' : '', deviceAdminApi ? 'lock/reset API referenced' : ''].filter(Boolean) },
    { id: 'dropper', label: 'Dropper', triggered: nestedFiles.some((f) => f.kind === 'apk' || f.kind === 'dex') && (has('INSTALL_PACKAGES') || dynamicCode), evidence: nestedFiles.filter((f) => f.kind === 'apk' || f.kind === 'dex').map((f) => f.name) },
  ];

  const bankerCombo = has('READ_SMS') && has('OVERLAY') && has('ACCESSIBILITY');
  const networkSend = has('INTERNET') && (httpC2.length > 0 || telegram.length > 0 || hardcodedIps.length > 0 || telegramBot);
  const silentExfiltration = (has('READ_SMS') || hasSmsReadApi) && networkSend && !hasLauncher;
  const dropper = nestedFiles.some((f) => f.kind === 'apk' || f.kind === 'dex') && (has('INSTALL_PACKAGES') || dynamicCode);

  const rules: Rule[] = [
    rule('banker-combo', 'Banker-trojan capability pattern', 30, bankerCombo, bankerCombo ? ['READ_SMS + SYSTEM_ALERT_WINDOW + BIND_ACCESSIBILITY_SERVICE declared together', 'this triad can read OTPs, overlay a fake bank screen and auto-click consent'] : [], 'Reading SMS, drawing overlays and abusing accessibility together is the canonical Android banking-trojan capability set. Each alone has legitimate uses; together they do not.', 'capability'),
    rule('sms-intercept', 'SMS interception', 15, has('READ_SMS') || has('RECEIVE_SMS'), permissions.filter((p) => p.short === 'READ_SMS' || p.short === 'RECEIVE_SMS').map((p) => `${p.name} declared`), 'SMS access lets the package read or intercept OTPs, the second factor protecting Indian bank accounts.', 'capability'),
    rule('overlay', 'Screen overlay injection', 15, has('OVERLAY'), has('OVERLAY') ? ['android.permission.SYSTEM_ALERT_WINDOW declared'] : [], 'Overlay permission lets the app draw over banking apps and capture credentials on a pixel-perfect fake screen.', 'capability'),
    rule('accessibility', 'Accessibility service abuse', 20, has('ACCESSIBILITY') || components.some((c) => /Accessibility/i.test(c.name)), [...(has('ACCESSIBILITY') ? ['android.permission.BIND_ACCESSIBILITY_SERVICE declared'] : []), ...components.filter((c) => /Accessibility/i.test(c.name)).map((c) => `${c.type} ${c.name}`)], 'Accessibility access can read every screen and perform taps on the user’s behalf, defeating most in-app protections.', 'capability'),
    rule('install-packages', 'Second-stage install capability', 10, has('INSTALL_PACKAGES'), has('INSTALL_PACKAGES') ? ['android.permission.REQUEST_INSTALL_PACKAGES declared'] : [], 'The package can drop and prompt installation of additional payloads after the first install.', 'capability'),
    rule('device-admin', 'Device administration', 10, has('DEVICE_ADMIN') || deviceAdminApi, [has('DEVICE_ADMIN') ? 'android.permission.BIND_DEVICE_ADMIN declared' : '', deviceAdminApi ? 'DevicePolicyManager lock/reset API referenced' : ''].filter(Boolean), 'Device-admin rights can resist uninstall and lock the device after a fraudulent transfer.', 'capability'),
    rule('contact-harvest', 'Contact and call-log harvesting', 8, has('READ_CONTACTS') || has('READ_CALL_LOG'), permissions.filter((p) => ['READ_CONTACTS', 'READ_CALL_LOG'].includes(p.short)).map((p) => `${p.name} declared`), 'Contact and call-log access is used to map the victim’s network and seed further smishing.', 'collection'),
    rule('query-packages', 'Banking-app enumeration', 8, has('QUERY_PACKAGES'), has('QUERY_PACKAGES') ? ['android.permission.QUERY_ALL_PACKAGES declared'] : [], 'Querying every installed package lets the malware detect and target specific banking and UPI apps.', 'collection'),
    rule('sms-send', 'SMS send API', 20, hasSmsSendApi, smsSendMethods.filter((name) => methodNames.has(name)).map((name) => `${name} referenced`), 'Sending SMS from inside the app is used to propagate links to the victim’s contacts and to intercept delivery confirmations.', 'capability'),
    rule('sms-provider-read', 'SMS database or broadcast access', 20, hasSmsReadApi, ['content://sms', 'SMS_RECEIVED', 'abortBroadcast'].filter((token) => stringBlob.includes(token) || methodNames.has(token)).map((token) => `references ${token}`), 'Reading the SMS database or aborting the SMS broadcast hides incoming bank alerts from the user.', 'capability'),
    rule('dynamic-code', 'Dynamic code loading or execution', 25, dynamicCode, dynamicEvidence, 'Loading DEX at runtime or spawning a shell lets the app run code that is not in the package you inspected.', 'capability'),
    rule('reflection', 'Reflection-heavy code', 10, reflection, [`${reflectionCount} reflection methods referenced`], 'Class.forName plus getMethod is used to reach hidden APIs and evade static checks; it is common in packers.', 'evasion'),
    rule('encrypted-blob', 'Large encoded blob', 8, base64Blobs.length > 0, [`${base64Blobs.length} base64-like string${base64Blobs.length === 1 ? '' : 's'} over 120 characters`], 'A large encoded blob next to network code usually holds a second-stage payload or an encrypted configuration.', 'evasion'),
    rule('device-admin-api', 'Device policy API references', 10, deviceAdminApi, deviceAdminApi ? ['lockNow / resetPassword / DevicePolicyManager referenced'] : [], 'Device policy APIs can lock the screen or wipe data after a fraudulent transfer.', 'capability'),
    rule('notification-listener', 'Notification listener', 8, notificationListener, notificationListener ? ['NotificationListenerService referenced'] : [], 'Notification access lets the app read OTP notifications without the SMS permission.', 'capability'),
    rule('usage-stats', 'Usage statistics access', 5, usageStats, usageStats ? ['UsageStatsManager referenced'] : [], 'Usage stats reveal which banking app is in the foreground, enabling timing attacks.', 'capability'),
    rule('silent-exfiltration', 'Silent exfiltration pattern', 20, silentExfiltration, [hasSmsReadApi ? 'SMS read access' : '', networkSend ? 'network send capability' : '', !hasLauncher ? 'no launcher icon declared' : ''].filter(Boolean), 'Reading SMS, sending it to the network and hiding the launcher icon is a complete silent exfiltration loop.', 'capability'),
    rule('dropper', 'Embedded second-stage payload', 25, dropper, [...nestedFiles.filter((f) => f.kind === 'apk' || f.kind === 'dex').map((f) => `${f.name} (${f.size} bytes)`), has('INSTALL_PACKAGES') ? 'REQUEST_INSTALL_PACKAGES' : '', dynamicCode ? 'dynamic code loading' : ''].filter(Boolean), 'An APK or DEX hidden inside assets plus install or class-loading capability is a dropper.', 'capability'),
    rule('impersonation', 'Brand impersonation', 30, Boolean(impersonation), impersonation ? [`label/package contains "${impersonation.keywords.find((k) => labelAndPackage.includes(k))}"`, `official package: ${impersonation.packages.join(', ')}`, `actual package: ${packageName}`] : [], 'The app presents a protected brand but is not signed as that brand’s official package.', 'identity'),
    rule('debug-signed', 'Debug-signed build', 12, certificate.debugSigned, certificate.debugSigned ? [debuggable ? 'android:debuggable="true" in manifest' : '', ...certFiles.filter((f) => /ANDROIDD/i.test(f))] : [], 'Production banking software is never debug-signed; this build was assembled for testing or rapid redeployment.', 'provenance'),
    rule('self-signed-unrelated', 'Self-signed certificate with unrelated subject', 10, Boolean(certificate.selfSigned && certificate.subject && !/android debug/i.test(certificate.subject)), certificate.selfSigned && certificate.subject ? [`subject ${certificate.subject}`] : [], 'A self-signed certificate whose subject has no relation to the claimed brand cannot be tied to a real publisher.', 'provenance'),
    rule('long-validity', 'Certificate valid for 30+ years', 5, Boolean(certificate.longValidity), certificate.longValidity ? [`${certificate.validFrom} to ${certificate.validTo}`] : [], 'Consumer certificates are renewed every one to two years; a 30-year validity is typical of a self-made signing key.', 'provenance'),
    rule('no-cert', 'No signing certificate', 15, !certificate.present, certificate.present ? [] : ['no META-INF/*.RSA|DSA|EC entry found'], 'An unsigned package cannot be traced to a publisher and may have been repacked after tampering.', 'provenance'),
    rule('packed', 'Packed or obfuscated: static analysis incomplete', 10, packed, [packerLibs.length ? `packer library: ${packerLibs.map((f) => f.name).join(', ')}` : '', shortNameRatio > 0.5 ? `${Math.round(shortNameRatio * 100)}% of names are 1-2 characters` : '', missingApplicationClass ? `application class ${applicationClass} is missing from dex` : '', dexFiles.length > 0 && dexTotal < 10_000 && largeAssets.length > 0 ? 'tiny dex with a large asset' : ''].filter(Boolean), 'Packing and obfuscation hide the real code from static analysis. TRACE cannot see what this app does.', 'evasion'),
    rule('http-c2', 'Cleartext command-and-control endpoint', 10, httpC2.length > 0, httpC2.slice(0, 3).map((i) => `${i.value} (${i.source})`), 'C2 traffic over plain HTTP is trivially interceptable and is not used by legitimate financial apps.', 'network'),
    rule('upi-collection', 'Embedded payment identifier', 10, upiIndicators.length > 0, upiIndicators.slice(0, 3).map((i) => `${i.value} (${i.source})`), 'A UPI handle embedded in the package gives the operator a direct collection route for stolen funds.', 'financial'),
    rule('telegram', 'Operator Telegram channel', 8, telegram.length > 0, telegram.slice(0, 3).map((i) => `${i.value} (${i.source})`), 'Telegram links are used for exfiltration and operator coordination; consumer banking apps do not embed them.', 'network'),
    rule('telegram-bot', 'Telegram bot API', 15, telegramBot, telegramBot ? ['api.telegram.org/bot referenced'] : [], 'A Telegram bot token in the package turns the app into a remote-controlled exfiltration client.', 'network'),
    rule('paste-host', 'Raw code or paste host', 15, pasteHosts, pasteHosts ? ['pastebin / raw.githubusercontent / transfer.sh referenced'] : [], 'Paste and raw-code hosts are used to fetch second-stage scripts and configuration at runtime.', 'network'),
    rule('shortener', 'Embedded URL shortener', 8, Boolean(shortenerHit), shortenerHit ? [`${shortenerHit} referenced`] : [], 'Shortened links hide the final destination and are not embedded in legitimate banking apps.', 'network'),
    rule('hardcoded-ip', 'Hardcoded IP address', 10, hardcodedIps.length > 0, hardcodedIps.slice(0, 3).map((i) => `${i.value} (${i.source})`), 'Hardcoded IPs bypass domain reputation and are typical of fixed C2 infrastructure.', 'network'),
    rule('nonstandard-port', 'Non-standard network port', 8, nonstandardPort, indicators.filter((i) => i.type === 'url' && /:\d{2,5}\//.test(i.value) && !/:(80|443)\//.test(i.value)).slice(0, 3).map((i) => i.value), 'Traffic to ports other than 80/443 is unusual for a consumer app and consistent with custom C2.', 'network'),
    rule('firebase', 'Firebase endpoint', 5, firebaseHit, indicators.filter((i) => i.type === 'domain' && /firebaseio|firebaseapp|web\.app/i.test(i.value)).slice(0, 2).map((i) => i.value), 'Firebase is a convenient free backend for short-lived scam campaigns; legitimate apps also use it, so weight is low.', 'network'),
    rule('exported-components', 'Exported attack surface', 5, exported.length >= 2, exported.slice(0, 4).map((c) => `${c.type} ${c.name} is exported`), 'Multiple exported components widen the attack surface and allow other apps to invoke sensitive flows.', 'surface'),
    rule('cleartext', 'Cleartext traffic permitted', 5, String(application['android:usesCleartextTraffic'] ?? 'false') === 'true', String(application['android:usesCleartextTraffic'] ?? 'false') === 'true' ? ['android:usesCleartextTraffic="true"'] : [], 'Allowing cleartext traffic lets the app talk to unencrypted endpoints, consistent with the HTTP C2 indicators.', 'network'),
  ];

  const reputationSkipped: CoverageCheck[] = [];
  if (KNOWN_BAD_HASHES.has(sha256)) {
    rules.push(rule('reputation-hash', 'Known-bad APK hash', 40, true, [`SHA-256 ${sha256} is in the bundled known-bad list`], 'This exact file hash appears in the local known-bad list.', 'reputation'));
  } else if (VT_KEY) {
    const vt = await virusTotalHash(sha256);
    if (vt.hits > 0) {
      rules.push(rule('reputation-hash', 'Flagged by VirusTotal', 40, true, [`${vt.hits} malicious or suspicious engine verdicts for this SHA-256`], 'VirusTotal lists this exact file hash as malicious. External reputation, not a local rule.', 'reputation'));
    }
    if (vt.skipped) reputationSkipped.push(vt.skipped);
  } else {
    reputationSkipped.push({
      id: 'reputation-hash',
      reason: REPUTATION_ENABLED
        ? 'No hash reputation source is configured; the bundled list is empty and VT_API_KEY is unset.'
        : 'Hash reputation lookups are off; set TRACE_ENABLE_REPUTATION=1 with VT_API_KEY to enable them.',
    });
  }

  const triggered = rules.filter((r) => r.triggered);
  const score = Math.min(100, triggered.reduce((sum, r) => sum + r.weight, 0));
  const riskLabel = riskFromScore(score);

  const checksSkipped: CoverageCheck[] = [
    { id: 'native-code', reason: 'Native .so files were inventoried but not disassembled.' },
    { id: 'dynamic-behaviour', reason: 'No code was executed; behaviour is inferred from static references.' },
    ...(packed ? [{ id: 'packed', reason: 'The APK appears packed or obfuscated, so most code and strings are hidden.' }] : []),
    ...(dexTruncated ? [{ id: 'dex-truncated', reason: 'One or more DEX files were truncated or malformed; only readable parts were scanned.' }] : []),
    ...(!certificate.present ? [{ id: 'signing', reason: 'No signing certificate was found in META-INF.' }] : []),
    ...reputationSkipped,
  ];
  const verdict = computeVerdict({
    score,
    findings: rulesToFindings(rules),
    coverage: {
      checksRun: [
        'manifest decode (binary AXML or text XML)',
        'permission and component extraction',
        `DEX string and method scan across ${dexFiles.length} file${dexFiles.length === 1 ? '' : 's'}`,
        'signing certificate parse',
        'nested payload and native library inventory',
      ],
      checksSkipped,
    },
    poorCoverage: packed,
  });

  const summary =
    triggered.length === 0
      ? 'No dangerous permission combinations, embedded payment routes or suspicious endpoints were found. This does not certify the app — it means the TRACE rule set found no signal.'
      : `This package requests ${permissions.filter((p) => p.dangerous).length} dangerous permissions and triggers ${triggered.length} rules for a score of ${score}/100. ${
          bankerCombo ? 'It declares the SMS + overlay + accessibility triad used by Android banking trojans. ' : ''
        }${httpC2.length ? `It contacts cleartext endpoint ${httpC2[0].value}. ` : ''}${
          upiIndicators.length ? `It embeds payment handle ${upiIndicators[0].value}. ` : ''
        }${certificate.debugSigned ? 'The build is debug-signed, not a production release. ' : ''}${packed ? 'The APK is packed, so this is a floor, not a full picture.' : ''}`.trim();

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
    verdict,
    nestedFiles,
    dexFiles,
    packed,
    capabilities,
  };
}
