/**
 * Minimal DEX reader: header, string_ids, type_ids and method_ids only.
 * Everything is bounds-checked and capped so a truncated or hostile file
 * degrades into a coverage note instead of a crash.
 */
export interface DexMethod {
  className: string;
  name: string;
}

export interface DexInfo {
  strings: string[];
  methods: DexMethod[];
  classNames: string[];
  truncated: boolean;
  error?: string;
}

const MAX_STRINGS = 120_000;
const MAX_METHODS = 120_000;
const MAX_CLASSES = 20_000;
const MAX_STRING_BYTES = 4096;

function readUleb128(buf: Buffer, offset: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let index = offset;
  while (index < buf.length && shift < 35) {
    const byte = buf[index++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result >>> 0, next: index };
    shift += 7;
  }
  return { value: result >>> 0, next: index };
}

function typeDescriptor(name: string): string {
  const trimmed = name.replace(/^L|;$/g, '');
  return trimmed || name;
}

export function parseDex(buf: Buffer): DexInfo {
  const out: DexInfo = { strings: [], methods: [], classNames: [], truncated: false };
  try {
    if (buf.length < 112 || buf.toString('latin1', 0, 4) !== 'dex\n') {
      return { ...out, error: 'not a DEX file' };
    }
    const fileSize = buf.readUInt32LE(0x20);
    const limit = Math.min(buf.length, fileSize || buf.length);
    if (fileSize > buf.length) out.truncated = true;

    const stringCount = buf.readUInt32LE(0x38);
    const stringOff = buf.readUInt32LE(0x3c);
    const typeCount = buf.readUInt32LE(0x40);
    const typeOff = buf.readUInt32LE(0x44);
    const methodCount = buf.readUInt32LE(0x58);
    const methodOff = buf.readUInt32LE(0x5c);
    const classCount = buf.readUInt32LE(0x60);
    const classOff = buf.readUInt32LE(0x64);

    const strings: string[] = [];
    const cappedStrings = Math.min(stringCount, MAX_STRINGS);
    if (cappedStrings < stringCount) out.truncated = true;
    for (let i = 0; i < cappedStrings; i++) {
      const idOff = stringOff + i * 4;
      if (idOff + 4 > limit) {
        out.truncated = true;
        break;
      }
      const dataOff = buf.readUInt32LE(idOff);
      if (dataOff >= limit) {
        out.truncated = true;
        continue;
      }
      const { next } = readUleb128(buf, dataOff);
      let end = next;
      while (end < limit && end - next < MAX_STRING_BYTES && buf[end] !== 0) end++;
      if (end >= limit) out.truncated = true;
      strings.push(buf.toString('utf8', next, end).replace(/\u0000/g, ''));
    }

    const types: string[] = [];
    const cappedTypes = Math.min(typeCount, MAX_STRINGS);
    for (let i = 0; i < cappedTypes; i++) {
      const idOff = typeOff + i * 4;
      if (idOff + 4 > limit) {
        out.truncated = true;
        break;
      }
      types.push(strings[buf.readUInt32LE(idOff)] ?? '');
    }

    const methods: DexMethod[] = [];
    const cappedMethods = Math.min(methodCount, MAX_METHODS);
    if (cappedMethods < methodCount) out.truncated = true;
    for (let i = 0; i < cappedMethods; i++) {
      const idOff = methodOff + i * 8;
      if (idOff + 8 > limit) {
        out.truncated = true;
        break;
      }
      const classIdx = buf.readUInt16LE(idOff);
      const nameIdx = buf.readUInt32LE(idOff + 4);
      methods.push({
        className: typeDescriptor(types[classIdx] ?? ''),
        name: strings[nameIdx] ?? '',
      });
    }

    const classNames: string[] = [];
    const cappedClasses = Math.min(classCount, MAX_CLASSES);
    if (cappedClasses < classCount) out.truncated = true;
    for (let i = 0; i < cappedClasses; i++) {
      const idOff = classOff + i * 32;
      if (idOff + 4 > limit) {
        out.truncated = true;
        break;
      }
      const classIdx = buf.readUInt32LE(idOff);
      const name = typeDescriptor(types[classIdx] ?? '');
      if (name) classNames.push(name);
    }

    out.strings = strings;
    out.methods = methods;
    out.classNames = classNames;
    return out;
  } catch (error) {
    return { ...out, truncated: true, error: error instanceof Error ? error.message : 'DEX parse failed' };
  }
}

/** All printable runs inside the raw DEX, used alongside the string table. */
export function dexPrintableRuns(buf: Buffer): string[] {
  return buf.toString('latin1').match(/[ -~]{6,}/g) ?? [];
}
