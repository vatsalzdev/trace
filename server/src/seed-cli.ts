import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, '..', 'data', 'trace.db');
for (const suffix of ['', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (existsSync(p)) unlinkSync(p);
}

const { seed } = await import('./seed');
const { caseCount } = await import('./db');
const result = await seed();
console.log(`[trace] reset database and seeded ${result.cases} cases (verified ${caseCount()})`);
