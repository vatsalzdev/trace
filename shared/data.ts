import brandsJson from '../data/brands.json';
import topDomainsJson from '../data/top-domains.json';
import watchlistJson from '../data/watchlist.json';

export interface Brand {
  name: string;
  keywords: string[];
  domains: string[];
  sector: string;
  appPackages?: string[];
}

/** Brands commonly impersonated in Indian and global cybercrime. Official domains
 *  suppress false positives: a brand mention alone is never a signal. */
export const BRANDS: Brand[] = [...(brandsJson as Brand[]), ...(watchlistJson as Brand[])];

/** Bundled popular-domain list used for TLD-swap and embedded-domain checks. */
export const TOP_DOMAINS: string[] = topDomainsJson as string[];

/** UPI handles issued by regulated PSPs. Anything outside this list is flagged. */
export const KNOWN_UPI_HANDLES = new Set([
  'okaxis', 'oksbi', 'okhdfcbank', 'okicici', 'ybl', 'ibl', 'axl', 'paytm', 'apl', 'upi',
  'airtel', 'jupiteraxis', 'fam', 'slc', 'yesbank', 'yesg', 'barodampay', 'mahb', 'cnrb',
  'postbank', 'freecharge', 'axisb', 'pockets', 'timecosmos', 'waaxis', 'wasbi', 'wahdfcbank',
  'waicici', 'icici', 'sbi', 'hdfcbank', 'indus', 'idfcbank', 'federal', 'rbl', 'kotak',
  'naviaxis', 'superyes', 'abfspay', 'ujjivan', 'jkb', 'pnb', 'cnrb', 'unionbankofindia',
]);

export const EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.in', 'outlook.com', 'hotmail.com', 'live.com',
  'rediffmail.com', 'protonmail.com', 'icloud.com', 'aol.com', 'zoho.com', 'mail.com',
]);

export const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'cut.tly', 'cutly.com', 'rb.gy', 'is.gd', 'ow.ly',
  'buff.ly', 'shorturl.at', 'tiny.cc', 'bitly.com', 'cutt.ly', 's.id', 'rebrand.ly',
  't.ly', 'shorturl.gg', 'urlz.fr', 'shorte.st', 'adf.ly', 'bl.ink', 'clck.ru',
]);

export const SUSPICIOUS_TLDS = new Set([
  'xyz', 'top', 'click', 'icu', 'vip', 'live', 'shop', 'cfd', 'sbs', 'buzz', 'fit',
  'monster', 'rest', 'quest', 'cyou', 'bond', 'work', 'support', 'help', 'surf',
  'bar', 'beauty', 'casa', 'cam', 'life', 'makeup', 'skin', 'today', 'uno', 'wtf',
  'tk', 'ml', 'ga', 'cf', 'gq', 'zip', 'mov', 'country', 'download', 'stream',
]);

/** Small public-suffix subset covering the domains this product sees. */
export const MULTI_PART_SUFFIXES = [
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in', 'gov.in', 'ac.in',
  'nic.in', 'res.in', 'edu.in', 'mil.in', 'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'co.jp', 'or.jp', 'ne.jp', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.sg',
  'com.br', 'co.za', 'com.ae', 'co.il', 'com.pk', 'com.bd', 'com.np', 'com.lk',
];

export const KNOWN_TLDS = new Set([
  'com', 'in', 'net', 'org', 'io', 'co', 'info', 'biz', 'me', 'dev', 'app', 'ai',
  'gov', 'edu', 'mil', 'us', 'uk', 'au', 'ca', 'de', 'fr', 'ru', 'cn', 'jp', 'sg',
  'ae', 'pk', 'bd', 'np', 'lk', 'br', 'za', 'sbi', 'link', 'online', 'site', 'store',
  'tech', 'cloud', 'pro', 'name', 'mobi', 'asia', 'tv', 'cc', 'ws', 'to', 'ly',
  'xyz', 'top', 'click', 'icu', 'vip', 'live', 'shop', 'cfd', 'sbs', 'buzz', 'fit',
  'monster', 'rest', 'quest', 'cyou', 'bond', 'work', 'support', 'help', 'surf',
  'tk', 'ml', 'ga', 'cf', 'gq', 'zip', 'mov', 'country', 'download', 'stream',
]);

export const URGENCY_PATTERNS = [
  /\burgent(?:ly)?\b/gi,
  /\bimmediately\b/gi,
  /\btoday\b/gi,
  /\bwithin\s+24\s*(?:hours|hrs)\b/gi,
  /\blast\s+(?:warning|chance|reminder)\b/gi,
  /\bwill\s+be\s+(?:blocked|suspended|deactivated|frozen)\b/gi,
  /\b(?:expires?|expiring)\s+(?:today|soon)\b/gi,
  /\bfinal\s+notice\b/gi,
  /\bact\s+now\b/gi,
  /\babhi\b/gi,
  /\bturant\b/gi,
];

export const KYC_PATTERNS = [
  /\bkyc\b/gi,
  /\bverify\b/gi,
  /\bverification\b/gi,
  /\bupdate\s+(?:your\s+)?details\b/gi,
  /\bre-?activate\b/gi,
  /\bpan\s+(?:card\s+)?(?:update|link)/gi,
];

export const CREDENTIAL_PATTERNS = [
  /\bshare\s+(?:the\s+|your\s+)?otp\b/gi,
  /\b(?:enter|send|provide|tell|forward)\s+(?:the\s+|your\s+)?(?:otp|pin|cvv|password)\b/gi,
  /\b(?:otp|pin|cvv|password|aadhaar|pan)\b(?=[^.!?]{0,40}\b(?:share|send|enter|provide|verify|update|submit)\b)/gi,
  /\b(?:share|send|enter|provide|verify|update|submit)\b[^.!?]{0,40}\b(?:otp|pin|cvv|password|aadhaar|pan)\b/gi,
  /\b(?:card\s+)?(?:pin|cvv|password)\b/gi,
  /\b(?:forward|send|share)\s+(?:me\s+)?(?:the\s+|your\s+)?(?:verification\s+)?(?:6[-\s]?digit\s+)?(?:code|otp)\b/gi,
];

export const AUTHORITY_PATTERNS = [
  /\barrest(?:ed)?\b/gi,
  /\bdigital\s+arrest\b/gi,
  /\blegal\s+action\b/gi,
  /\bfir\b/gi,
  /\bpolice\b/gi,
  /\bcustoms\b/gi,
  /\bcourt\s+(?:notice|summons)\b/gi,
  /\benforcement\s+directorate\b/gi,
  /\bmoney\s+laundering\b/gi,
];

export const PRIZE_PATTERNS = [
  /\bwon\b/gi,
  /\bwinner\b/gi,
  /\blottery\b/gi,
  /\bcashback\b/gi,
  /\brefund\b/gi,
  /\bgift\b/gi,
  /\breward\s+points?\b/gi,
  /\blucky\s+draw\b/gi,
  /\bprize\b/gi,
];

export const PAYMENT_PATTERNS = [
  /\bpay\b/gi,
  /\bpayment\b/gi,
  /\bfee\b/gi,
  /\bprocessing\s+(?:charge|fee)\b/gi,
  /\bwallet\b/gi,
  /\baccount\s+(?:number|no)\b/gi,
  /\btransfer\b/gi,
  /\bremit\b/gi,
];

export const APK_PATTERNS = [
  /\.apk\b/gi,
  /\binstall\s+(?:the\s+)?app\b/gi,
  /\bdownload\s+(?:the\s+)?app\b/gi,
  /\bupdate\s+(?:the\s+)?app\b/gi,
  /\bsideload\b/gi,
];

/* ------------------------------------------------------------------ */
/* Phase A — link-less scam families. Case-insensitive by construction. */
/* ------------------------------------------------------------------ */

/** A "new number / lost phone" story. Must pair with a money request to fire. */
export const FAMILY_STORY_PATTERNS = [
  /\bthis\s+is\s+my\s+new\s+(?:number|phone|mobile|sim)\b/gi,
  /\b(?:it'?s|this\s+is)\s+my\s+new\b/gi,
  /\bnew\s+(?:number|sim)\b/gi,
  /\bnaya\s+number\b/gi,
  /\b(?:phone|mobile|cell|sim)\s+(?:broke|broken|lost|damaged|stolen|switched\s+off|kharab)\b/gi,
  /\bphone\s+kharab\b/gi,
  /\bnumber\s+badl\s+gaya\b/gi,
  /\b(?:mummy|mumma|mom|papa|dad|daddy)\b/gi,
];

/** Money / urgency request. Must pair with a family story to fire. */
export const FAMILY_MONEY_PATTERNS = [
  /\bsend\s+(?:me\s+)?(?:some\s+)?money\b/gi,
  /\btransfer\s+(?:me\s+)?(?:some\s+)?(?:money|cash|funds)\b/gi,
  /\bpay\s+(?:a\s+)?bill\b/gi,
  /\b(?:need|require)\s+(?:some\s+)?(?:money|cash|funds)\b/gi,
  /\bpaise\s+bhej(?:o|do|na|dena)\b/gi,
  /\bpaisa\s+bhej(?:o|do|na|dena)\b/gi,
  /\b(?:rs\.?|₹)\s?\d[\d,]{1,7}\b/gi,
  /\burgent(?:ly)?\b/gi,
  /\babhi\b/gi,
  /\bturant\b/gi,
  /\bupi\b/gi,
];

/** Job / task lure. Fires with earning language. */
export const JOB_PATTERNS = [
  /\bpart[-\s]?time\b/gi,
  /\bwork\s+from\s+home\b/gi,
  /\bremote\s+(?:role|job|work)\b/gi,
  /\blike\s+(?:videos?|reels?|posts?)\b/gi,
  /\bsimple\s+tasks?\b/gi,
  /\bghar\s+baithe\b/gi,
  /\btelegram\b/gi,
];

/** Earning language required alongside a job lure. */
export const JOB_EARNING_PATTERNS = [
  /\b(?:earn|make|income|salary|payout|kama(?:o|i|ye))\b/gi,
  /\b(?:rs\.?|₹)\s?[\d,]+\s*(?:per|\/|a)\s*(?:day|hour|week)\b/gi,
  /\bdaily\s+(?:payout|earning|income|payment)\b/gi,
  /\bpaise\s+kamao\b/gi,
];

/** "I sent my code by mistake" — OTP forward requests. */
export const ACCIDENTAL_CODE_PATTERNS = [
  /\bsent\s+(?:my|the|your)?\s*(?:code|otp)\s+by\s+mistake\b/gi,
  /\b(?:accidentally|by\s+mistake)\s+(?:sent|forwarded)\b/gi,
  /\bforward\s+(?:me\s+)?(?:the\s+)?(?:code|otp)\b/gi,
  /\bsend\s+(?:me\s+)?(?:the\s+)?(?:6|six)[-\s]?digit\s+(?:code|otp)\b/gi,
  /\bcode\s+by\s+mistake\b/gi,
  /\bgalti\s+se\s+(?:code|otp)\b/gi,
  /\botp\s+bhej\s+(?:do|dena)\b/gi,
];

/** Utility disconnection threats. */
export const UTILITY_PATTERNS = [
  /\b(?:electricity|power|gas|water|sim|mobile|broadband|dth)\b[^.!?]{0,40}\b(?:disconnect|disconnection|cut\s+off)\b/gi,
  /\b(?:disconnect|disconnection|cut\s+off)\b[^.!?]{0,40}\b(?:electricity|power|gas|water|sim|mobile|broadband|dth)\b/gi,
  /\bwill\s+be\s+(?:disconnected|cut\s+off)\b/gi,
  /\b(?:bijli|paani|gas)\s+(?:kat|band)\s+(?:jayegi|hogi|jaega)\b/gi,
  /\bpay\s+via\s+this\s+link\b/gi,
];


export const SUSPICIOUS_PATH_WORDS = [
  'login', 'signin', 'verify', 'verification', 'kyc', 'secure', 'security',
  'update', 'claim', 'refund', 'unlock', 'confirm', 'validate', 'auth', 'account',
  'wallet', 'payment', 'recover', 'support', 'help', 'otp', 'pin',
];

export interface DangerousPermission {
  name: string;
  short: string;
  weight: number;
  reason: string;
}

export const DANGEROUS_PERMISSIONS: DangerousPermission[] = [
  { name: 'android.permission.SEND_SMS', short: 'SEND_SMS', weight: 14, reason: 'Can send premium or fraudulent SMS without user action.' },
  { name: 'android.permission.READ_SMS', short: 'READ_SMS', weight: 16, reason: 'Can read OTP and bank messages — the core capability of an OTP stealer.' },
  { name: 'android.permission.RECEIVE_SMS', short: 'RECEIVE_SMS', weight: 16, reason: 'Intercepts incoming OTPs before the user sees them.' },
  { name: 'android.permission.READ_CONTACTS', short: 'READ_CONTACTS', weight: 8, reason: 'Harvests the contact graph for onward smishing.' },
  { name: 'android.permission.READ_CALL_LOG', short: 'READ_CALL_LOG', weight: 8, reason: 'Exfiltrates call history and identifies banking relationships.' },
  { name: 'android.permission.RECORD_AUDIO', short: 'RECORD_AUDIO', weight: 10, reason: 'Can record calls or ambient audio.' },
  { name: 'android.permission.CAMERA', short: 'CAMERA', weight: 7, reason: 'Can capture documents or the user without consent.' },
  { name: 'android.permission.READ_EXTERNAL_STORAGE', short: 'READ_STORAGE', weight: 6, reason: 'Can read downloaded statements, screenshots and KYC documents.' },
  { name: 'android.permission.WRITE_EXTERNAL_STORAGE', short: 'WRITE_STORAGE', weight: 4, reason: 'Can stage payloads or tamper with local files.' },
  { name: 'android.permission.SYSTEM_ALERT_WINDOW', short: 'OVERLAY', weight: 18, reason: 'Draws over banking apps — the standard overlay-injection technique.' },
  { name: 'android.permission.REQUEST_INSTALL_PACKAGES', short: 'INSTALL_PACKAGES', weight: 12, reason: 'Can silently drop and install a second-stage payload.' },
  { name: 'android.permission.BIND_ACCESSIBILITY_SERVICE', short: 'ACCESSIBILITY', weight: 22, reason: 'Accessibility access lets malware read screens and click for the user.' },
  { name: 'android.permission.BIND_DEVICE_ADMIN', short: 'DEVICE_ADMIN', weight: 14, reason: 'Can resist uninstall and lock the device.' },
  { name: 'android.permission.READ_PHONE_STATE', short: 'PHONE_STATE', weight: 6, reason: 'Reads SIM and device identifiers used for targeting.' },
  { name: 'android.permission.ACCESS_FINE_LOCATION', short: 'FINE_LOCATION', weight: 5, reason: 'Tracks victim location.' },
  { name: 'android.permission.RECEIVE_BOOT_COMPLETED', short: 'BOOT_COMPLETED', weight: 5, reason: 'Restarts itself after reboot for persistence.' },
  { name: 'android.permission.QUERY_ALL_PACKAGES', short: 'QUERY_PACKAGES', weight: 9, reason: 'Enumerates installed banking and UPI apps to target.' },
  { name: 'android.permission.CALL_PHONE', short: 'CALL_PHONE', weight: 6, reason: 'Can place calls to premium numbers or impersonate support.' },
  { name: 'android.permission.PROCESS_OUTGOING_CALLS', short: 'OUTGOING_CALLS', weight: 8, reason: 'Can intercept and reroute outgoing calls.' },
  { name: 'android.permission.POST_NOTIFICATIONS', short: 'NOTIFICATIONS', weight: 2, reason: 'Delivers deceptive notifications.' },
];

export const BRAND_SECTORS: Record<string, string> = Object.fromEntries(
  BRANDS.map((b) => [b.name, b.sector]),
);
