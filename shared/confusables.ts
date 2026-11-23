/**
 * Offline homoglyph support. This is a compact subset of the Unicode TR39
 * confusable data covering the Cyrillic and Greek letters that realistically
 * appear in look-alike domains. No network access, no ML.
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

function basicToDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
}

/** RFC 3492 punycode decoder for a single `xn--` label. Returns the input on failure. */
export function decodePunycodeLabel(label: string): string {
  const input = label.replace(/^xn--/i, '');
  if (!input) return label;
  try {
    const output: number[] = [];
    let n = INITIAL_N;
    let i = 0;
    let bias = INITIAL_BIAS;
    const delimiter = input.lastIndexOf('-');
    const basic = delimiter < 0 ? 0 : delimiter;
    for (let j = 0; j < basic; j++) {
      const code = input.charCodeAt(j);
      if (code >= 128) return label;
      output.push(code);
    }
    let index = delimiter < 0 ? 0 : delimiter + 1;
    while (index < input.length) {
      const oldi = i;
      let w = 1;
      for (let k = BASE; ; k += BASE) {
        if (index >= input.length) return label;
        const digit = basicToDigit(input.charCodeAt(index++));
        if (digit >= BASE) return label;
        i += digit * w;
        const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
        if (digit < t) break;
        w *= BASE - t;
      }
      const outLen = output.length + 1;
      bias = adapt(i - oldi, outLen, oldi === 0);
      n += Math.floor(i / outLen);
      i %= outLen;
      if (n > 0x10ffff) return label;
      output.splice(i, 0, n);
      i++;
    }
    return String.fromCodePoint(...output);
  } catch {
    return label;
  }
}

export function toUnicodeHost(host: string): string {
  return host
    .split('.')
    .map((label) => (label.toLowerCase().startsWith('xn--') ? decodePunycodeLabel(label) : label))
    .join('.');
}

const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  '\u0430': 'a', '\u0431': 'b', '\u0432': 'b', '\u0433': 'r', '\u0434': 'd', '\u0435': 'e',
  '\u0451': 'e', '\u0436': 'x', '\u0437': '3', '\u0438': 'u', '\u0439': 'u', '\u043a': 'k',
  '\u043b': 'n', '\u043c': 'm', '\u043d': 'h', '\u043e': 'o', '\u043f': 'n', '\u0440': 'p',
  '\u0441': 'c', '\u0442': 't', '\u0443': 'y', '\u0444': 'f', '\u0445': 'x', '\u0446': 'u',
  '\u0447': 'y', '\u0448': 'w', '\u0449': 'w', '\u044a': 'b', '\u044b': 'bl', '\u044c': 'b',
  '\u044d': 'e', '\u044e': 'io', '\u044f': 'r', '\u0455': 's', '\u0456': 'i', '\u0457': 'i',
  '\u0458': 'j', '\u04bb': 'h', '\u0501': 'd', '\u051b': 'q', '\u051d': 'w', '\u04cf': 'l',
  // Greek
  '\u03b1': 'a', '\u03b2': 'b', '\u03b3': 'y', '\u03b4': 'd', '\u03b5': 'e', '\u03b6': 'z',
  '\u03b7': 'n', '\u03b8': 'o', '\u03b9': 'i', '\u03ba': 'k', '\u03bb': 'l', '\u03bc': 'u',
  '\u03bd': 'v', '\u03be': 'e', '\u03bf': 'o', '\u03c0': 'n', '\u03c1': 'p', '\u03c2': 'c',
  '\u03c3': 'o', '\u03c4': 't', '\u03c5': 'u', '\u03c6': 'o', '\u03c7': 'x', '\u03c8': 'w',
  '\u03c9': 'w', '\u0391': 'a', '\u0392': 'b', '\u0395': 'e', '\u0396': 'z', '\u0397': 'h',
  '\u0399': 'i', '\u039a': 'k', '\u039c': 'm', '\u039d': 'n', '\u039f': 'o', '\u03a1': 'p',
  '\u03a4': 't', '\u03a5': 'y', '\u03a7': 'x',
};

/** TR39-style skeleton: NFKD, strip marks, map confusables, keep [a-z0-9]. */
export function skeleton(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split('')
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

export type ScriptName = 'latin' | 'cyrillic' | 'greek' | 'devanagari' | 'other';

export function scriptOf(ch: string): ScriptName {
  const code = ch.codePointAt(0) ?? 0;
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return 'latin';
  if ((code >= 0x0400 && code <= 0x04ff) || (code >= 0x0500 && code <= 0x052f)) return 'cyrillic';
  if (code >= 0x0370 && code <= 0x03ff) return 'greek';
  if (code >= 0x0900 && code <= 0x097f) return 'devanagari';
  return 'other';
}

/** True when one label mixes Latin with Cyrillic or Greek look-alikes. */
export function detectMixedScript(label: string): { mixed: boolean; scripts: ScriptName[]; unicode: string } {
  const unicode = label.toLowerCase().startsWith('xn--') ? decodePunycodeLabel(label) : label;
  const scripts = new Set<ScriptName>();
  for (const ch of unicode) {
    const script = scriptOf(ch);
    if (script !== 'other' && script !== 'devanagari') scripts.add(script);
  }
  const list = [...scripts];
  const confusable = list.filter((s) => s === 'latin' || s === 'cyrillic' || s === 'greek');
  return { mixed: confusable.length >= 2, scripts: list, unicode };
}
