import JSZip from 'jszip';
import { encodeAxml, type AxmlNode } from './axml';

export const SAMPLE_APK_NAME = 'SBI_KYC_Update_v2.4.1.apk';

const PERMISSIONS = [
  'android.permission.SEND_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.READ_SMS',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_PHONE_STATE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.BIND_ACCESSIBILITY_SERVICE',
  'android.permission.QUERY_ALL_PACKAGES',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.CAMERA',
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.FOREGROUND_SERVICE',
];

function manifestTree(): AxmlNode {
  return {
    name: 'manifest',
    attrs: {
      package: 'com.sbi.kycupdate',
      'android:versionName': '2.4.1',
      'android:versionCode': '241',
    },
    children: [
      { name: 'uses-sdk', attrs: { 'android:minSdkVersion': '23', 'android:targetSdkVersion': '33' }, children: [] },
      ...PERMISSIONS.map((p) => ({ name: 'uses-permission', attrs: { 'android:name': p }, children: [] })),
      {
        name: 'application',
        attrs: {
          'android:label': 'SBI KYC Update',
          'android:debuggable': 'true',
          'android:allowBackup': 'true',
          'android:usesCleartextTraffic': 'true',
        },
        children: [
          {
            name: 'activity',
            attrs: { 'android:name': '.MainActivity', 'android:exported': 'true' },
            children: [
              {
                name: 'intent-filter',
                attrs: {},
                children: [
                  { name: 'action', attrs: { 'android:name': 'android.intent.action.MAIN' }, children: [] },
                  { name: 'category', attrs: { 'android:name': 'android.intent.category.LAUNCHER' }, children: [] },
                ],
              },
            ],
          },
          {
            name: 'activity',
            attrs: { 'android:name': '.KycWebView', 'android:exported': 'false' },
            children: [],
          },
          {
            name: 'service',
            attrs: { 'android:name': '.OverlayService', 'android:exported': 'true' },
            children: [],
          },
          {
            name: 'service',
            attrs: {
              'android:name': '.AccessibilityRelay',
              'android:exported': 'true',
              'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
            },
            children: [
              {
                name: 'intent-filter',
                attrs: {},
                children: [
                  {
                    name: 'action',
                    attrs: { 'android:name': 'android.accessibilityservice.AccessibilityService' },
                    children: [],
                  },
                ],
              },
            ],
          },
          {
            name: 'receiver',
            attrs: { 'android:name': '.SmsRelayReceiver', 'android:exported': 'true' },
            children: [
              {
                name: 'intent-filter',
                attrs: {},
                children: [
                  { name: 'action', attrs: { 'android:name': 'android.provider.Telephony.SMS_RECEIVED' }, children: [] },
                ],
              },
            ],
          },
          {
            name: 'provider',
            attrs: {
              'android:name': '.PayloadProvider',
              'android:authorities': 'com.sbi.kycupdate.payload',
              'android:exported': 'false',
            },
            children: [],
          },
        ],
      },
    ],
  };
}

const C2_BLOCK = `
# TRACE fixture payload — synthetic, non-functional
api_base=http://sbi-kyc-verify.in/api/v2/collect
fallback=https://sbi-kyc-verify.in/verify/session
payment_handle=kyc.support@fakebank
operator_telegram=https://t.me/tracecollector
beacon=185.62.190.44:8443
support_email=support@sbi-kyc-verify.in
sms_forward=+919812345670
`;

const DEX_STRINGS = `
Lcom/sbi/kycupdate/MainActivity;
Lcom/sbi/kycupdate/OverlayService;
Lcom/sbi/kycupdate/SmsRelayReceiver;
Lcom/sbi/kycupdate/AccessibilityRelay;
http://sbi-kyc-verify.in/api/v2/collect
https://sbi-kyc-verify.in/verify/session
kyc.support@fakebank
https://t.me/tracecollector
185.62.190.44:8443
com.phonepe.app
net.one97.paytm
com.google.android.apps.nbu.paisa.user
`;

function dexBlob(strings = DEX_STRINGS): Buffer {
  const header = Buffer.from('dex\n035\0', 'latin1');
  const body = Buffer.alloc(2048);
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + 7) & 0xff;
  return Buffer.concat([header, Buffer.from(strings, 'latin1'), body]);
}

function fakeCert(): Buffer {
  const header = Buffer.from('3082030c308201f4a003020102020900', 'hex');
  const body = Buffer.alloc(512);
  for (let i = 0; i < body.length; i++) body[i] = (i * 17 + 3) & 0xff;
  return Buffer.concat([header, body, Buffer.from('SBI KYC UPDATE SIGNING', 'latin1')]);
}

export async function buildSampleApk(): Promise<Buffer> {
  const zip = new JSZip();
  const date = new Date('2026-01-12T10:00:00Z');
  const options = { date, compression: 'DEFLATE' as const };

  zip.file('AndroidManifest.xml', encodeAxml(manifestTree()), options);
  zip.file('classes.dex', dexBlob(), options);
  zip.file('assets/config.dat', Buffer.from(C2_BLOCK, 'utf8'), options);
  zip.file('assets/strings.xml', Buffer.from(C2_BLOCK.replace(/=/g, '>'), 'utf8'), options);
  zip.file(
    'res/raw/payload.json',
    Buffer.from(
      JSON.stringify(
        {
          campaign: 'sbi-kyc-2026',
          endpoints: ['http://sbi-kyc-verify.in/api/v2/collect', 'http://185.62.190.44:8443/beacon'],
          payout: 'kyc.support@fakebank',
          telegram: 'https://t.me/tracecollector',
        },
        null,
        2,
      ),
      'utf8',
    ),
    options,
  );
  const arsc = Buffer.alloc(1024);
  for (let i = 0; i < arsc.length; i++) arsc[i] = (i * 13) & 0xff;
  Buffer.from('sbi-kyc-verify.in', 'latin1').copy(arsc, 128);
  zip.file('resources.arsc', arsc, options);
  zip.file('lib/arm64-v8a/libkylib.so', dexBlob().subarray(0, 900), options);
  zip.file('META-INF/CERT.RSA', fakeCert(), options);
  zip.file(
    'META-INF/MANIFEST.MF',
    Buffer.from(
      'Manifest-Version: 1.0\r\nCreated-By: 1.0 (Android SignApk)\r\n\r\nName: AndroidManifest.xml\r\nSHA-256-Digest: 3f9c2a7d8e1b4c6f0a2d5e8b7c1f4a9d2e6b8c3f5a7d9e1b4c6f8a2d5e7b9c1f\r\n',
      'utf8',
    ),
    options,
  );

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'DOS' });
}

/* ------------------------------------------------------------------ */
/* Phase D — labelled synthetic fixtures for the evaluation runner.    */
/* ------------------------------------------------------------------ */

export type ApkFixtureKind =
  | 'benign'
  | 'sms-reader'
  | 'overlay-only'
  | 'banker-triad'
  | 'dropper'
  | 'packed-like'
  | 'debug-signed'
  | 'impersonator';

interface FixtureSpec {
  name: string;
  packageName: string;
  label: string;
  permissions: string[];
  debuggable: boolean;
  cleartext: boolean;
  launcher: boolean;
  dexStrings: string;
  assets?: Record<string, string>;
  packerLib?: boolean;
  nestedApk?: boolean;
  cert: 'normal' | 'debug' | 'none';
}

const FIXTURES: Record<ApkFixtureKind, FixtureSpec> = {
  benign: {
    name: 'com.trace.notes',
    packageName: 'com.trace.notes',
    label: 'Trace Notes',
    permissions: ['android.permission.INTERNET'],
    debuggable: false,
    cleartext: false,
    launcher: true,
    dexStrings: 'Lcom/trace/notes/MainActivity;\nLcom/trace/notes/NoteStore;\nsaveNote\nloadNote',
    cert: 'normal',
  },
  'sms-reader': {
    name: 'com.trace.smsreader',
    packageName: 'com.trace.smsreader',
    label: 'SMS Backup Utility',
    permissions: ['android.permission.READ_SMS', 'android.permission.RECEIVE_SMS', 'android.permission.INTERNET'],
    debuggable: false,
    cleartext: false,
    launcher: true,
    dexStrings: 'Lcom/trace/smsreader/MainActivity;\ncontent://sms\nabortBroadcast\nsendTextMessage\nTelephony.Sms',
    cert: 'normal',
  },
  'overlay-only': {
    name: 'com.trace.overlay',
    packageName: 'com.trace.overlay',
    label: 'Theme Pack',
    permissions: ['android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.INTERNET'],
    debuggable: false,
    cleartext: true,
    launcher: true,
    dexStrings: 'Lcom/trace/overlay/ThemeService;\nTYPE_APPLICATION_OVERLAY\naddView\nhttp://185.62.190.44/overlay',
    cert: 'normal',
  },
  'banker-triad': {
    name: 'com.trace.banker',
    packageName: 'com.trace.banker',
    label: 'Secure Banking Helper',
    permissions: [
      'android.permission.READ_SMS',
      'android.permission.RECEIVE_SMS',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.BIND_ACCESSIBILITY_SERVICE',
      'android.permission.INTERNET',
    ],
    debuggable: false,
    cleartext: true,
    launcher: true,
    dexStrings: 'Lcom/trace/banker/OverlayService;\ncontent://sms\nsendTextMessage\nTYPE_APPLICATION_OVERLAY\nhttp://185.62.190.44/collect',
    cert: 'normal',
  },
  dropper: {
    name: 'com.trace.dropper',
    packageName: 'com.trace.dropper',
    label: 'System Update',
    permissions: ['android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.INTERNET'],
    debuggable: false,
    cleartext: false,
    launcher: true,
    dexStrings: 'Lcom/trace/dropper/MainActivity;\nDexClassLoader\nPathClassLoader\nhttp://185.62.190.44/stage2',
    nestedApk: true,
    cert: 'normal',
  },
  'packed-like': {
    name: 'com.trace.packed',
    packageName: 'com.trace.packed',
    label: 'Calculator',
    permissions: ['android.permission.INTERNET'],
    debuggable: false,
    cleartext: false,
    launcher: true,
    dexStrings: 'Lcom/trace/packed/MainActivity;\ncalculate',
    packerLib: true,
    cert: 'normal',
  },
  'debug-signed': {
    name: 'com.trace.debug',
    packageName: 'com.trace.debug',
    label: 'Debug Build',
    permissions: ['android.permission.INTERNET'],
    debuggable: true,
    cleartext: false,
    launcher: true,
    dexStrings: 'Lcom/trace/debug/MainActivity;\nhello',
    cert: 'debug',
  },
  impersonator: {
    name: 'com.sbi.kycupdate',
    packageName: 'com.sbi.kycupdate',
    label: 'SBI KYC Update',
    permissions: ['android.permission.INTERNET'],
    debuggable: false,
    cleartext: true,
    launcher: true,
    dexStrings: 'Lcom/sbi/kycupdate/MainActivity;\nhttp://sbi-kyc-verify.in/api/collect',
    cert: 'normal',
  },
};

function fixtureManifest(spec: FixtureSpec): AxmlNode {
  const children: AxmlNode[] = [
    { name: 'uses-sdk', attrs: { 'android:minSdkVersion': '24', 'android:targetSdkVersion': '33' }, children: [] },
    ...spec.permissions.map((p) => ({ name: 'uses-permission', attrs: { 'android:name': p }, children: [] })),
    {
      name: 'application',
      attrs: {
        'android:label': spec.label,
        'android:debuggable': spec.debuggable ? 'true' : 'false',
        'android:usesCleartextTraffic': spec.cleartext ? 'true' : 'false',
      },
      children: [
        {
          name: 'activity',
          attrs: { 'android:name': '.MainActivity', 'android:exported': 'true' },
          children: spec.launcher
            ? [
                {
                  name: 'intent-filter',
                  attrs: {},
                  children: [
                    { name: 'action', attrs: { 'android:name': 'android.intent.action.MAIN' }, children: [] },
                    { name: 'category', attrs: { 'android:name': 'android.intent.category.LAUNCHER' }, children: [] },
                  ],
                },
              ]
            : [],
        },
      ],
    },
  ];
  return {
    name: 'manifest',
    attrs: { package: spec.packageName, 'android:versionName': '1.0.0', 'android:versionCode': '1' },
    children,
  };
}

export async function buildApkFixture(kind: ApkFixtureKind): Promise<{ name: string; buffer: Buffer }> {
  const spec = FIXTURES[kind];
  const zip = new JSZip();
  const date = new Date('2026-02-01T10:00:00Z');
  const options = { date, compression: 'DEFLATE' as const };

  zip.file('AndroidManifest.xml', encodeAxml(fixtureManifest(spec)), options);
  zip.file('classes.dex', dexBlob(spec.dexStrings), options);
  if (spec.assets) {
    for (const [path, content] of Object.entries(spec.assets)) zip.file(path, Buffer.from(content, 'utf8'), options);
  }
  if (spec.packerLib) {
    const packer = Buffer.alloc(1200);
    for (let i = 0; i < packer.length; i++) packer[i] = (i * 7 + 11) & 0xff;
    zip.file('lib/arm64-v8a/libjiagu.so', packer, options);
  }
  if (spec.nestedApk) {
    const inner = new JSZip();
    inner.file('AndroidManifest.xml', encodeAxml(fixtureManifest(FIXTURES.benign)), options);
    inner.file('classes.dex', dexBlob('Lcom/trace/notes/MainActivity;'), options);
    zip.file('assets/payload.apk', await inner.generateAsync({ type: 'nodebuffer' }), options);
  }
  if (spec.cert === 'debug') zip.file('META-INF/ANDROIDD.RSA', fakeCert(), options);
  else if (spec.cert === 'normal') zip.file('META-INF/CERT.RSA', fakeCert(), options);

  return { name: `${kind}.apk`, buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'DOS' }) };
}

