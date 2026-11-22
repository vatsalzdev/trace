/**
 * Minimal Android binary XML (AXML) codec.
 * Covers the chunks emitted by aapt2 for AndroidManifest.xml: string pool,
 * resource map, start/end namespace and start/end element. Attribute values
 * are resolved through the string pool (rawValue) with typed-value fallback.
 */

export interface AxmlNode {
  name: string;
  attrs: Record<string, string>;
  children: AxmlNode[];
}

const RES_XML_TYPE = 0x0003;
const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_START_NAMESPACE = 0x0100;
const RES_XML_END_NAMESPACE = 0x0101;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_END_ELEMENT = 0x0103;
const RES_XML_RESOURCE_MAP = 0x0180;

const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

interface StringPool {
  strings: string[];
  end: number;
}

function readLength8(buf: Buffer, offset: number): { value: number; next: number } {
  let value = buf[offset];
  let next = offset + 1;
  if (value & 0x80) {
    value = ((value & 0x7f) << 8) | buf[next];
    next += 1;
  }
  return { value, next };
}

function decodeStringPool(buf: Buffer, offset: number): StringPool {
  const headerSize = buf.readUInt16LE(offset + 2);
  const size = buf.readUInt32LE(offset + 4);
  const stringCount = buf.readUInt32LE(offset + 8);
  const styleCount = buf.readUInt32LE(offset + 12);
  const flags = buf.readUInt32LE(offset + 16);
  const stringsStart = buf.readUInt32LE(offset + 20);
  const utf8 = (flags & 0x100) !== 0;
  const strings: string[] = [];
  for (let i = 0; i < stringCount; i++) {
    const stringOffset = buf.readUInt32LE(offset + headerSize + i * 4);
    const p = offset + stringsStart + stringOffset;
    if (p >= buf.length) {
      strings.push('');
      continue;
    }
    if (utf8) {
      const l1 = readLength8(buf, p);
      const l2 = readLength8(buf, l1.next);
      const start = l2.next;
      strings.push(buf.subarray(start, start + l2.value).toString('utf8'));
    } else {
      let len = buf.readUInt16LE(p);
      let start = p + 2;
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p + 2);
        start = p + 4;
      }
      strings.push(buf.subarray(start, start + len * 2).toString('utf16le'));
    }
  }
  return { strings, end: offset + size + (styleCount > 0 ? 0 : 0) };
}

export function decodeAxml(buf: Buffer): AxmlNode {
  if (buf.length < 8) throw new Error('AXML buffer too small');
  const magic = buf.readUInt16LE(0);
  if (magic !== RES_XML_TYPE) throw new Error('Not a binary Android XML document');
  let offset = 8;
  let pool: string[] = [];
  let nsMap: Record<string, string> = {};
  const stack: AxmlNode[] = [];
  let root: AxmlNode | null = null;

  while (offset + 8 <= buf.length) {
    const type = buf.readUInt16LE(offset);
    const headerSize = buf.readUInt16LE(offset + 2);
    const size = buf.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > buf.length) break;

    if (type === RES_STRING_POOL_TYPE) {
      pool = decodeStringPool(buf, offset).strings;
    } else if (type === RES_XML_START_NAMESPACE) {
      const prefixIdx = buf.readInt32LE(offset + 16);
      const uriIdx = buf.readInt32LE(offset + 20);
      const prefix = prefixIdx >= 0 ? pool[prefixIdx] : '';
      const uri = uriIdx >= 0 ? pool[uriIdx] : '';
      if (uri) nsMap[uri] = prefix || (uri.includes('android.com/apk/res/android') ? 'android' : '');
    } else if (type === RES_XML_START_ELEMENT) {
      const nsIdx = buf.readInt32LE(offset + 16);
      const nameIdx = buf.readInt32LE(offset + 20);
      const attributeStart = buf.readUInt16LE(offset + 24);
      const attributeSize = buf.readUInt16LE(offset + 26);
      const attributeCount = buf.readUInt16LE(offset + 28);
      const attrBase = offset + 16 + attributeStart;
      const attrs: Record<string, string> = {};
      for (let i = 0; i < attributeCount; i++) {
        const p = attrBase + i * attributeSize;
        if (p + 20 > offset + size) break;
        const attrNs = buf.readInt32LE(p);
        const attrNameIdx = buf.readInt32LE(p + 4);
        const rawValueIdx = buf.readInt32LE(p + 8);
        const dataType = buf.readUInt8(p + 15);
        const data = buf.readUInt32LE(p + 16);
        const name = pool[attrNameIdx] ?? `attr_${attrNameIdx}`;
        let prefix = '';
        if (attrNs >= 0) {
          const uri = pool[attrNs] ?? '';
          prefix = nsMap[uri] ?? (uri.includes('android.com/apk/res/android') ? 'android' : '');
        }
        let value = '';
        if (rawValueIdx >= 0 && pool[rawValueIdx] !== undefined) {
          value = pool[rawValueIdx];
        } else if (dataType === 0x03) {
          value = pool[data] ?? '';
        } else if (dataType === 0x12) {
          value = data !== 0 ? 'true' : 'false';
        } else if (dataType === 0x10 || dataType === 0x11) {
          value = String(data | 0);
        } else if (dataType === 0x01) {
          value = `@0x${data.toString(16)}`;
        } else {
          value = String(data);
        }
        attrs[prefix ? `${prefix}:${name}` : name] = value;
      }
      const node: AxmlNode = { name: pool[nameIdx] ?? 'unknown', attrs, children: [] };
      void nsIdx;
      if (stack.length) stack[stack.length - 1].children.push(node);
      else root = node;
      stack.push(node);
    } else if (type === RES_XML_END_ELEMENT) {
      stack.pop();
    }
    offset += size;
    void headerSize;
  }

  if (!root) throw new Error('AXML contained no root element');
  return root;
}

/* ------------------------------- encoder -------------------------------- */

class Pool {
  strings: string[] = [];
  index = new Map<string, number>();
  add(value: string): number {
    const existing = this.index.get(value);
    if (existing !== undefined) return existing;
    const idx = this.strings.length;
    this.strings.push(value);
    this.index.set(value, idx);
    return idx;
  }
}

interface ENode {
  name: string;
  attrs: Record<string, string>;
  children: ENode[];
}

function chunk(type: number, headerSize: number, body: Buffer): Buffer {
  const buf = Buffer.alloc(8 + body.length);
  buf.writeUInt16LE(type, 0);
  buf.writeUInt16LE(headerSize, 2);
  buf.writeUInt32LE(8 + body.length, 4);
  body.copy(buf, 8);
  return buf;
}

function encodeStringPool(strings: string[]): Buffer {
  const headerSize = 28;
  const offsets: number[] = [];
  const chunks: Buffer[] = [];
  let cursor = 0;
  for (const s of strings) {
    offsets.push(cursor);
    const bytes = Buffer.from(s, 'utf8');
    const utf16len = s.length;
    const parts: number[] = [];
    if (utf16len > 0x7f) parts.push(0x80 | (utf16len >> 8), utf16len & 0xff);
    else parts.push(utf16len);
    if (bytes.length > 0x7f) parts.push(0x80 | (bytes.length >> 8), bytes.length & 0xff);
    else parts.push(bytes.length);
    const head = Buffer.from(parts);
    chunks.push(Buffer.concat([head, bytes, Buffer.from([0])]));
    cursor += head.length + bytes.length + 1;
  }
  const offsetsBuf = Buffer.alloc(offsets.length * 4);
  offsets.forEach((o, i) => offsetsBuf.writeUInt32LE(o, i * 4));
  const stringsStart = headerSize + offsetsBuf.length;
  const header = Buffer.alloc(20);
  header.writeUInt32LE(strings.length, 0);
  header.writeUInt32LE(0, 4);
  header.writeUInt32LE(0x100, 8);
  header.writeUInt32LE(stringsStart, 12);
  header.writeUInt32LE(0, 16);
  const body = Buffer.concat([header, offsetsBuf, ...chunks]);
  const out = Buffer.alloc(8 + body.length);
  out.writeUInt16LE(RES_STRING_POOL_TYPE, 0);
  out.writeUInt16LE(headerSize, 2);
  out.writeUInt32LE(8 + body.length, 4);
  body.copy(out, 8);
  return out;
}

function nodeHeader(type: number, size: number, line: number): Buffer {
  const buf = Buffer.alloc(16);
  buf.writeUInt16LE(type, 0);
  buf.writeUInt16LE(16, 2);
  buf.writeUInt32LE(size, 4);
  buf.writeUInt32LE(line, 8);
  buf.writeUInt32LE(0xffffffff, 12);
  return buf;
}

export function encodeAxml(root: ENode): Buffer {
  const pool = new Pool();
  const androidNsIdx = pool.add(ANDROID_NS);
  const androidPrefixIdx = pool.add('android');
  pool.add('manifest');

  const collect = (node: ENode) => {
    pool.add(node.name);
    for (const name of Object.keys(node.attrs)) {
      pool.add(name.startsWith('android:') ? name.slice('android:'.length) : name);
    }
    node.children.forEach(collect);
  };
  collect(root);

  // Collect attribute values after all names are registered.
  const collectValues = (node: ENode) => {
    for (const value of Object.values(node.attrs)) pool.add(value);
    node.children.forEach(collectValues);
  };
  collectValues(root);

  const encodeNode = (node: ENode, line: number): Buffer => {
    const attrCount = Object.keys(node.attrs).length;
    const size = 36 + attrCount * 20;
    const head = nodeHeader(RES_XML_START_ELEMENT, size, line);
    const ext = Buffer.alloc(20);
    ext.writeInt32LE(-1, 0);
    ext.writeInt32LE(pool.add(node.name), 4);
    ext.writeUInt16LE(20, 8);
    ext.writeUInt16LE(20, 10);
    ext.writeUInt16LE(attrCount, 12);
    ext.writeUInt16LE(0, 14);
    ext.writeUInt16LE(0, 16);
    ext.writeUInt16LE(0, 18);
    const attrs: Buffer[] = [];
    for (const [rawName, value] of Object.entries(node.attrs)) {
      const android = rawName.startsWith('android:');
      const name = android ? rawName.slice('android:'.length) : rawName;
      const attr = Buffer.alloc(20);
      attr.writeInt32LE(android ? androidNsIdx : -1, 0);
      attr.writeInt32LE(pool.add(name), 4);
      const valueIdx = pool.add(value);
      attr.writeInt32LE(valueIdx, 8);
      attr.writeUInt16LE(8, 12);
      attr.writeUInt8(0, 14);
      attr.writeUInt8(0x03, 15);
      attr.writeUInt32LE(valueIdx, 16);
      attrs.push(attr);
    }
    const children = node.children.map((c, i) => encodeNode(c, line + i + 1));
    const endHead = nodeHeader(RES_XML_END_ELEMENT, 24, line);
    const end = Buffer.alloc(8);
    end.writeInt32LE(-1, 0);
    end.writeInt32LE(pool.add(node.name), 4);
    return Buffer.concat([head, ext, ...attrs, ...children, endHead, end]);
  };

  const startNs = Buffer.concat([
    nodeHeader(RES_XML_START_NAMESPACE, 24, 1),
    (() => {
      const b = Buffer.alloc(8);
      b.writeInt32LE(androidPrefixIdx, 0);
      b.writeInt32LE(androidNsIdx, 4);
      return b;
    })(),
  ]);
  const endNs = Buffer.concat([
    nodeHeader(RES_XML_END_NAMESPACE, 24, 1),
    (() => {
      const b = Buffer.alloc(8);
      b.writeInt32LE(androidPrefixIdx, 0);
      b.writeInt32LE(androidNsIdx, 4);
      return b;
    })(),
  ]);

  // Values were registered after names; rebuild the pool ordering so that the
  // encoder's string indexes match the emitted table.
  const poolStrings = pool.strings;
  const stringPool = encodeStringPool(poolStrings);
  const resourceMap = chunk(RES_XML_RESOURCE_MAP, 8, Buffer.alloc(0));
  const xml = Buffer.concat([stringPool, resourceMap, startNs, encodeNode(root, 1), endNs]);

  const header = Buffer.alloc(8);
  header.writeUInt16LE(RES_XML_TYPE, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + xml.length, 4);
  return Buffer.concat([header, xml]);
}

export const AXML_ANDROID_NS = ANDROID_NS;
