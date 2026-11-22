import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSampleApk, SAMPLE_APK_NAME } from '../src/sample-apk';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'data');
mkdirSync(outDir, { recursive: true });
const buffer = await buildSampleApk();
const out = join(outDir, SAMPLE_APK_NAME);
writeFileSync(out, buffer);
console.log(`wrote ${out}`);
console.log(`bytes  ${buffer.length}`);
console.log(`sha256 ${createHash('sha256').update(buffer).digest('hex')}`);
