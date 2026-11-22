import express from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApkAnalysis, EntityType, UrlAnalysis } from '../../shared/types';
import { analyzeMessage } from '../../shared/message';
import { analyzeUrl } from '../../shared/url';
import { inspectApk } from './apk';
import {
  addEntityToCase,
  buildGraph,
  createReport,
  getCase,
  getEntity,
  getReport,
  listCases,
  listEntities,
  listReports,
  relatedEntity,
  saveCase,
  stats,
  updateCase,
  type EntityInput,
} from './db';
import { enrichUrl } from './enrich';
import { buildSampleApk, SAMPLE_APK_NAME } from './sample-apk';
import { seedIfEmpty } from './seed';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 5174);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 48 * 1024 * 1024 } });
const apkCache = new Map<string, ApkAnalysis>();

app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown> | unknown) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

function messageEntities(result: ReturnType<typeof analyzeMessage>): EntityInput[] {
  return result.entities.map((e) => ({ type: e.type, value: e.normalized, note: e.note, suspicious: e.suspicious }));
}

function urlEntities(result: UrlAnalysis & { enrichment?: { dns: { a: string[] } } }): EntityInput[] {
  const list: EntityInput[] = [
    { type: 'domain', value: result.registrableDomain },
    { type: 'url', value: result.normalized },
  ];
  for (const ip of result.enrichment?.dns.a ?? []) list.push({ type: 'ip', value: ip, note: 'A record' });
  return list;
}

function apkEntities(result: ApkAnalysis): EntityInput[] {
  return result.indicators.map((i) => ({ type: i.type, value: i.normalized, note: i.source }));
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'trace-api', now: new Date().toISOString() });
});

app.post(
  '/api/analyze/message',
  wrap(async (req, res) => {
    const text = String(req.body?.text ?? '');
    if (!text.trim()) return res.status(400).json({ ok: false, error: 'Message text is required' });
    const result = analyzeMessage(text);
    let caseId: string | undefined;
    if (req.body?.save) {
      const saved = saveCase({
        title: String(req.body?.title ?? `Message analysis — ${result.riskLabel} risk`),
        status: 'open',
        source_type: 'message',
        raw_input: text,
        analysis: result,
        entities: messageEntities(result),
      });
      caseId = saved.case.id;
    }
    res.json({ ok: true, analysis: result, entities: messageEntities(result), caseId });
  }),
);

app.post(
  '/api/analyze/url',
  wrap(async (req, res) => {
    const input = String(req.body?.url ?? '').trim();
    if (!input) return res.status(400).json({ ok: false, error: 'URL is required' });
    try {
      const result = await enrichUrl(input);
      let caseId: string | undefined;
      if (req.body?.save) {
        const saved = saveCase({
          title: String(req.body?.title ?? `URL analysis — ${result.registrableDomain}`),
          status: 'open',
          source_type: 'url',
          raw_input: input,
          analysis: result,
          entities: urlEntities(result),
        });
        caseId = saved.case.id;
      }
      res.json({ ok: true, analysis: result, entities: urlEntities(result), caseId });
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'URL analysis failed' });
    }
  }),
);

app.post(
  '/api/analyze/apk',
  upload.single('apk'),
  wrap(async (req, res) => {
    let buffer: Buffer;
    let fileName: string;
    if (req.file) {
      buffer = req.file.buffer;
      fileName = req.file.originalname;
    } else if (req.body?.sample) {
      buffer = await buildSampleApk();
      fileName = SAMPLE_APK_NAME;
    } else {
      return res.status(400).json({ ok: false, error: 'Attach an APK file or pass { sample: true }' });
    }
    try {
      const result = await inspectApk(buffer, fileName);
      apkCache.set(result.sha256, result);
      let caseId: string | undefined;
      if (req.body?.save) {
        const saved = saveCase({
          title: String(req.body?.title ?? `APK inspection — ${result.packageName}`),
          status: 'open',
          source_type: 'apk',
          raw_input: fileName,
          analysis: result,
          entities: apkEntities(result),
          eventMessage: 'APK ingested and unpacked (AXML manifest decoded)',
        });
        caseId = saved.case.id;
      }
      res.json({ ok: true, analysis: result, caseId });
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : 'APK inspection failed' });
    }
  }),
);

app.get(
  '/api/sample-apk',
  wrap(async (_req, res) => {
    const buffer = await buildSampleApk();
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${SAMPLE_APK_NAME}"`);
    res.send(buffer);
  }),
);

app.get(
  '/api/cases',
  wrap(async (req, res) => {
    res.json({ ok: true, cases: listCases({ status: String(req.query.status ?? ''), source: String(req.query.source ?? ''), q: String(req.query.q ?? '') }) });
  }),
);

app.post(
  '/api/cases',
  wrap(async (req, res) => {
    const source = String(req.body?.source_type ?? 'message');
    const raw = String(req.body?.raw_input ?? '');
    const title = String(req.body?.title ?? '').trim();
    const status = (req.body?.status ?? 'open') as 'open' | 'investigating' | 'closed';
    const notes = String(req.body?.notes ?? '');
    if (!raw.trim()) return res.status(400).json({ ok: false, error: 'raw_input is required' });

    if (source === 'apk') {
      const hash = String(req.body?.sha256 ?? '');
      const cached = apkCache.get(hash);
      if (!cached) return res.status(409).json({ ok: false, error: 'APK analysis not cached. Re-upload the package.' });
      const saved = saveCase({
        title: title || `APK inspection — ${cached.packageName}`,
        status,
        source_type: 'apk',
        raw_input: cached.fileName,
        analysis: cached,
        entities: apkEntities(cached),
        notes,
        eventMessage: 'APK re-saved from inspection cache',
      });
      return res.json({ ok: true, case: saved.case, caseId: saved.case.id });
    }

    const analysis = source === 'url' ? await enrichUrl(raw) : analyzeMessage(raw);
    const entities = source === 'url' ? urlEntities(analysis as UrlAnalysis) : messageEntities(analysis as ReturnType<typeof analyzeMessage>);
    const saved = saveCase({
      title: title || `${source === 'url' ? 'URL' : 'Message'} analysis — ${analysis.riskLabel} risk`,
      status,
      source_type: source === 'url' ? 'url' : 'message',
      raw_input: raw,
      analysis,
      entities,
      notes,
    });
    res.json({ ok: true, case: saved.case, caseId: saved.case.id });
  }),
);

app.get(
  '/api/cases/:id',
  wrap(async (req, res) => {
    const c = getCase(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, case: c });
  }),
);

app.patch(
  '/api/cases/:id',
  wrap(async (req, res) => {
    const c = updateCase(req.params.id, {
      title: req.body?.title,
      status: req.body?.status,
      notes: req.body?.notes,
    });
    if (!c) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, case: c });
  }),
);

app.post(
  '/api/cases/:id/entities',
  wrap(async (req, res) => {
    const ok = addEntityToCase(req.params.id, Number(req.body?.entityId));
    if (!ok) return res.status(404).json({ ok: false, error: 'Case or entity not found' });
    res.json({ ok: true, case: getCase(req.params.id) });
  }),
);

app.post(
  '/api/cases/:id/report-data',
  wrap(async (req, res) => {
    const payload = createReport(req.params.id, req.body?.analyst);
    if (!payload) return res.status(404).json({ ok: false, error: 'Case not found' });
    res.json({ ok: true, report: payload });
  }),
);

app.get(
  '/api/reports',
  wrap(async (_req, res) => {
    res.json({ ok: true, reports: listReports() });
  }),
);

app.get(
  '/api/reports/:id',
  wrap(async (req, res) => {
    const report = getReport(req.params.id);
    if (!report) return res.status(404).json({ ok: false, error: 'Report not found' });
    res.json({ ok: true, report });
  }),
);

app.get(
  '/api/entities',
  wrap(async (req, res) => {
    res.json({ ok: true, entities: listEntities(String(req.query.q ?? ''), String(req.query.type ?? '')) });
  }),
);

app.get(
  '/api/entities/:id',
  wrap(async (req, res) => {
    const entity = getEntity(Number(req.params.id));
    if (!entity) return res.status(404).json({ ok: false, error: 'Entity not found' });
    res.json({ ok: true, entity });
  }),
);

app.get(
  '/api/entities/:id/related',
  wrap(async (req, res) => {
    const related = relatedEntity(Number(req.params.id));
    if (!related) return res.status(404).json({ ok: false, error: 'Entity not found' });
    res.json({ ok: true, ...related });
  }),
);

app.get(
  '/api/graph',
  wrap(async (_req, res) => {
    res.json({ ok: true, ...buildGraph() });
  }),
);

app.get(
  '/api/stats',
  wrap(async (_req, res) => {
    res.json({ ok: true, ...stats() });
  }),
);

const dist = join(here, '..', '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[trace] api error:', err.message);
  res.status(500).json({ ok: false, error: err.message || 'Internal error' });
});

async function main() {
  await seedIfEmpty();
  app.listen(PORT, () => {
    console.log(`[trace] api listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error('[trace] failed to start', error);
  process.exit(1);
});
