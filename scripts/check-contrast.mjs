import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CSS_PATH = join(ROOT, 'client', 'src', 'styles.css');
const EVIDENCE_PATH = join(ROOT, 'tests', 'artifacts', 'contrast-light.txt');
const MIN_AA = 4.5;

const css = readFileSync(CSS_PATH, 'utf8');

function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing CSS block: ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unclosed CSS block: ${selector}`);
}

function variables(source) {
  const out = new Map();
  for (const [, name, value] of source.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out.set(name, value.trim());
  }
  return out;
}

const dark = variables(block(':root {'));
const light = variables(block("[data-theme='light'] {"));
const tokens = new Map([...dark, ...light]);

function rgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
}

function hex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function resolveColor(value, base = '#ffffff') {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) return hex(rgb(trimmed));
  const match = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+\s*([\d.]+))?\s*\)$/i);
  if (!match) throw new Error(`Unsupported color: ${trimmed}`);
  const fg = [Number(match[1]), Number(match[2]), Number(match[3])];
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  const bg = rgb(base);
  return hex(fg.map((channel, i) => channel * alpha + bg[i] * (1 - alpha)));
}

function luminance(color) {
  const [r, g, b] = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background, base = '#ffffff') {
  const a = luminance(resolveColor(foreground, base));
  const b = luminance(resolveColor(background, base));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const checks = [];
function check(label, foreground, background, base = '#ffffff') {
  const fg = token(foreground);
  const bg = token(background);
  checks.push({ label, fg, bg, ratio: contrast(fg, bg, resolveColor(base)) });
}

function token(name) {
  const value = tokens.get(name);
  if (!value) throw new Error(`Missing token: ${name}`);
  return value;
}

const surfaces = ['--bg', '--bg-1', '--bg-2', '--bg-3', '--surface', '--surface-focus', '--raised', '--graph-canvas', '--overlay'];
for (const text of ['--text', '--text-2', '--text-3']) {
  for (const surface of surfaces) check(`${text} on ${surface}`, text, surface);
}
for (const status of ['--accent', '--danger', '--warn', '--ok']) {
  for (const surface of surfaces) check(`${status} on ${surface}`, status, surface);
}
for (const [label, fg, bg] of [
  ['risk-high-fg on tinted bg-2', '--risk-high-fg', '--risk-high-bg'],
  ['risk-high-fg on tinted bg-3', '--risk-high-fg', '--risk-high-bg'],
  ['risk-medium-fg on tinted bg-2', '--risk-medium-fg', '--risk-medium-bg'],
  ['risk-medium-fg on tinted bg-3', '--risk-medium-fg', '--risk-medium-bg'],
  ['risk-low-fg on tinted bg-2', '--risk-low-fg', '--risk-low-bg'],
  ['risk-low-fg on tinted bg-3', '--risk-low-fg', '--risk-low-bg'],
  ['mark-url-fg on tinted bg-2', '--mark-url-fg', '--mark-url-bg'],
  ['mark-upi-fg on tinted bg-2', '--mark-upi-fg', '--mark-upi-bg'],
  ['mark-phone-fg on tinted bg-2', '--mark-phone-fg', '--mark-phone-bg'],
  ['mark-email-fg on tinted bg-2', '--mark-email-fg', '--mark-email-bg'],
  ['mark-account-fg on tinted bg-2', '--mark-account-fg', '--mark-account-bg'],
  ['btn-accent-fg on tinted bg-2', '--btn-accent-fg', '--btn-accent-bg'],
  ['btn-primary-fg on btn bg', '--btn-primary-fg', '--text'],
  ['selection-text on tinted bg-2', '--selection-text', '--selection-bg'],
]) {
  const base = label.includes('bg-3') ? token('--bg-3') : token('--bg-2');
  check(label, fg, bg, base);
}

const lines = [
  'TRACE light console contrast audit',
  `Minimum AA body-text ratio: ${MIN_AA}:1`,
  '',
  'Supplied values that were darkened to reach AA:',
  `  --text-3: supplied #7a7a85 -> ${light.get('--text-3')}`,
  `  --accent: supplied #5b5bf0 -> ${light.get('--accent')}`,
  `  --danger: supplied #d92d2d -> ${light.get('--danger')}`,
  `  --warn: supplied #b45309 -> ${light.get('--warn')}`,
  `  --ok: supplied #15803d -> ${light.get('--ok')}`,
  '',
  ...checks.map((c) => `${c.ratio >= MIN_AA ? 'PASS' : 'FAIL'} ${c.ratio.toFixed(2)}:1  ${c.label}`),
  '',
  `Checked ${checks.length} text/background pairs; ${checks.filter((c) => c.ratio < MIN_AA).length} failed.`,
];

mkdirSync(join(ROOT, 'tests', 'artifacts'), { recursive: true });
writeFileSync(EVIDENCE_PATH, `${lines.join('\n')}\n`);
console.log(lines.join('\n'));

if (checks.some((c) => c.ratio < MIN_AA)) process.exitCode = 1;
