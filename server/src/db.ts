import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseRecord, EntityRecord, EntityType, EventRecord, ReportPayload } from '../../shared/types';
import { normalizeEntity } from '../../shared/message';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.TRACE_DB_DIR ? resolve(process.env.TRACE_DB_DIR) : join(here, '..', 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
export const DB_PATH = join(dataDir, 'trace.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  risk_label TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  input TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(type, value)
);
CREATE TABLE IF NOT EXISTS case_entities (
  case_id TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  context TEXT,
  PRIMARY KEY (case_id, entity_id),
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  analyst TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_entities_entity ON case_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_events_case ON events(case_id);
`);

export function nowIso(): string {
  return new Date().toISOString();
}

export function caseCount(): number {
  return (db.prepare('SELECT COUNT(*) as c FROM cases').get() as { c: number }).c;
}

export function nextCaseId(year = new Date().getFullYear()): string {
  const row = db.prepare("SELECT id FROM cases WHERE id LIKE ? ORDER BY id DESC LIMIT 1").get(`TRC-${year}-%`) as { id: string } | undefined;
  const last = row ? Number(row.id.split('-').pop()) : 0;
  return `TRC-${year}-${String(last + 1).padStart(4, '0')}`;
}

export interface EntityInput {
  type: EntityType;
  value: string;
  note?: string;
  suspicious?: boolean;
}

export function upsertEntity(entity: EntityInput, when: string, risk: number, caseId: string): number {
  const value = normalizeEntity(entity.type, entity.value);
  if (!value) return 0;
  const existing = db.prepare('SELECT id, metadata_json FROM entities WHERE type = ? AND value = ?').get(entity.type, value) as
    | { id: number; metadata_json: string }
    | undefined;
  if (existing) {
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(existing.metadata_json);
    } catch {
      meta = {};
    }
    const cases = new Set<string>(Array.isArray(meta.cases) ? (meta.cases as string[]) : []);
    cases.add(caseId);
    meta.cases = [...cases];
    meta.suspicious = Boolean(meta.suspicious || entity.suspicious);
    if (entity.note) meta.note = entity.note;
    db.prepare(
      `UPDATE entities SET last_seen = ?, risk_score = MAX(risk_score, ?), metadata_json = ? WHERE id = ?`,
    ).run(when, risk, JSON.stringify(meta), existing.id);
    return existing.id;
  }
  const meta = { cases: [caseId], suspicious: Boolean(entity.suspicious), note: entity.note ?? null };
  const info = db
    .prepare(
      `INSERT INTO entities (type, value, first_seen, last_seen, risk_score, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(entity.type, value, when, when, risk, JSON.stringify(meta));
  return Number(info.lastInsertRowid);
}

export interface SaveCaseInput {
  title: string;
  status?: 'open' | 'investigating' | 'closed';
  source_type: 'message' | 'url' | 'apk' | 'manual';
  raw_input: string;
  analysis: object & { score: number; riskLabel: string; rules?: unknown[] };
  entities: EntityInput[];
  notes?: string;
  createdAt?: string;
  eventMessage?: string;
}

export function saveCase(input: SaveCaseInput): { case: CaseRecord; entityIds: number[]; newEntities: number } {
  const when = input.createdAt ?? nowIso();
  const id = nextCaseId(new Date(when).getFullYear());
  const riskScore = Math.max(0, Math.min(100, Math.round(input.analysis.score ?? 0)));
  const riskLabel = input.analysis.riskLabel ?? (riskScore >= 60 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW');

  db.prepare(
    `INSERT INTO cases (id, title, status, risk_label, risk_score, source_type, raw_input, created_at, updated_at, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.title, input.status ?? 'open', riskLabel, riskScore, input.source_type, input.raw_input, when, when, input.notes ?? '');

  db.prepare(`INSERT INTO analyses (case_id, kind, input, result_json, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    input.source_type,
    input.raw_input,
    JSON.stringify(input.analysis),
    when,
  );

  const entityIds: number[] = [];
  let newEntities = 0;
  const seen = new Set<string>();
  for (const entity of input.entities) {
    const norm = normalizeEntity(entity.type, entity.value);
    if (!norm || seen.has(`${entity.type}:${norm}`)) continue;
    seen.add(`${entity.type}:${norm}`);
    const before = db.prepare('SELECT id FROM entities WHERE type = ? AND value = ?').get(entity.type, norm);
    const eid = upsertEntity(entity, when, riskScore, id);
    if (!eid) continue;
    if (!before) newEntities++;
    entityIds.push(eid);
    db.prepare('INSERT OR REPLACE INTO case_entities (case_id, entity_id, context) VALUES (?, ?, ?)').run(
      id,
      eid,
      entity.note ?? entity.type,
    );
  }

  db.prepare(`INSERT INTO events (case_id, type, message, created_at) VALUES (?, ?, ?, ?)`).run(
    id,
    'created',
    input.eventMessage ?? `Case opened from ${input.source_type} analysis`,
    when,
  );
  if (entityIds.length) {
    db.prepare(`INSERT INTO events (case_id, type, message, created_at) VALUES (?, ?, ?, ?)`).run(
      id,
      'entities',
      `${entityIds.length} indicators linked (${newEntities} new)`,
      when,
    );
  }

  return { case: getCase(id) as CaseRecord, entityIds, newEntities };
}

function withEntityCount(c: CaseRecord): CaseRecord {
  return c;
}

export function listCases(filters: { status?: string; source?: string; q?: string } = {}): CaseRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status && filters.status !== 'all') {
    clauses.push('c.status = ?');
    params.push(filters.status);
  }
  if (filters.source && filters.source !== 'all') {
    clauses.push('c.source_type = ?');
    params.push(filters.source);
  }
  if (filters.q) {
    clauses.push('(c.title LIKE ? OR c.id LIKE ? OR c.raw_input LIKE ?)');
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM case_entities ce WHERE ce.case_id = c.id) as entity_count
       FROM cases c ${where} ORDER BY c.updated_at DESC`,
    )
    .all(...params) as CaseRecord[];
  return rows.map(withEntityCount);
}

export function getCase(id: string): (CaseRecord & { analyses?: unknown[]; events?: EventRecord[] }) | null {
  const row = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM case_entities ce WHERE ce.case_id = c.id) as entity_count
       FROM cases c WHERE c.id = ?`,
    )
    .get(id) as CaseRecord | undefined;
  if (!row) return null;
  const entities = db
    .prepare(
      `SELECT e.* FROM entities e JOIN case_entities ce ON ce.entity_id = e.id WHERE ce.case_id = ? ORDER BY e.type, e.value`,
    )
    .all(id) as EntityRecord[];
  const analyses = db.prepare('SELECT id, kind, input, result_json, created_at FROM analyses WHERE case_id = ? ORDER BY id DESC').all(id) as {
    id: number;
    kind: string;
    input: string;
    result_json: string;
    created_at: string;
  }[];
  const events = db.prepare('SELECT * FROM events WHERE case_id = ? ORDER BY created_at DESC, id DESC').all(id) as EventRecord[];
  return {
    ...row,
    entities,
    analyses: analyses.map((a) => ({ ...a, result_json: safeJson(a.result_json) })),
    events,
  };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function updateCase(id: string, patch: { title?: string; status?: string; notes?: string }): CaseRecord | null {
  const current = db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRecord | undefined;
  if (!current) return null;
  const title = patch.title ?? current.title;
  const status = patch.status ?? current.status;
  const notes = patch.notes ?? current.notes;
  const when = nowIso();
  db.prepare('UPDATE cases SET title = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?').run(title, status, notes, when, id);
  if (patch.status && patch.status !== current.status) {
    db.prepare('INSERT INTO events (case_id, type, message, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      'status',
      `Status changed from ${current.status} to ${status}`,
      when,
    );
  }
  if (patch.notes !== undefined) {
    db.prepare('INSERT INTO events (case_id, type, message, created_at) VALUES (?, ?, ?, ?)').run(id, 'note', 'Analyst notes updated', when);
  }
  return getCase(id);
}

export function addEntityToCase(caseId: string, entityId: number): boolean {
  const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(entityId) as EntityRecord | undefined;
  const c = db.prepare('SELECT id FROM cases WHERE id = ?').get(caseId);
  if (!entity || !c) return false;
  db.prepare('INSERT OR IGNORE INTO case_entities (case_id, entity_id, context) VALUES (?, ?, ?)').run(caseId, entityId, 'manual link');
  db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(nowIso(), caseId);
  db.prepare('INSERT INTO events (case_id, type, message, created_at) VALUES (?, ?, ?, ?)').run(
    caseId,
    'entity',
    `Indicator ${entity.type}:${entity.value} linked manually`,
    nowIso(),
  );
  return true;
}

export function listEntities(q?: string, type?: string): EntityRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q) {
    clauses.push('(value LIKE ? OR type LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (type && type !== 'all') {
    clauses.push('type = ?');
    params.push(type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM case_entities ce WHERE ce.entity_id = e.id) as case_count
       FROM entities e ${where} ORDER BY case_count DESC, last_seen DESC LIMIT 500`,
    )
    .all(...params) as EntityRecord[];
}

export function getEntity(id: number): EntityRecord | null {
  const row = db
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM case_entities ce WHERE ce.entity_id = e.id) as case_count
       FROM entities e WHERE e.id = ?`,
    )
    .get(id) as EntityRecord | undefined;
  return row ?? null;
}

export function relatedEntity(id: number): {
  entity: EntityRecord;
  cases: (CaseRecord & { shared: number })[];
  neighbours: (EntityRecord & { co_occurrences: number })[];
} | null {
  const entity = getEntity(id);
  if (!entity) return null;
  const cases = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM case_entities ce2 WHERE ce2.case_id = c.id) as entity_count,
       (SELECT COUNT(*) FROM case_entities ce3 WHERE ce3.case_id = c.id) as shared
       FROM cases c JOIN case_entities ce ON ce.case_id = c.id WHERE ce.entity_id = ? ORDER BY c.updated_at DESC`,
    )
    .all(id) as (CaseRecord & { shared: number })[];
  const neighbours = db
    .prepare(
      `SELECT e.*, COUNT(DISTINCT ce2.case_id) as co_occurrences,
        (SELECT COUNT(*) FROM case_entities ce4 WHERE ce4.entity_id = e.id) as case_count
       FROM entities e
       JOIN case_entities ce2 ON ce2.entity_id = e.id
       JOIN case_entities ce1 ON ce1.case_id = ce2.case_id AND ce1.entity_id = ?
       WHERE e.id != ?
       GROUP BY e.id ORDER BY co_occurrences DESC, e.risk_score DESC LIMIT 40`,
    )
    .all(id, id) as (EntityRecord & { co_occurrences: number })[];
  return { entity, cases, neighbours };
}

export function events(limit = 20): (EventRecord & { case_title?: string })[] {
  return db
    .prepare(
      `SELECT ev.*, c.title as case_title FROM events ev JOIN cases c ON c.id = ev.case_id ORDER BY ev.created_at DESC, ev.id DESC LIMIT ?`,
    )
    .all(limit) as (EventRecord & { case_title?: string })[];
}

function relationFor(a: string, b: string): string {
  const pair = new Set([a, b]);
  if (pair.has('domain') && pair.has('ip')) return 'hosted_on';
  if (pair.has('upi') && (pair.has('phone') || pair.has('domain') || pair.has('url') || pair.has('account'))) return 'requests_payment_to';
  if ((pair.has('package') || pair.has('apk_hash')) && (pair.has('url') || pair.has('domain') || pair.has('ip') || pair.has('upi'))) {
    return 'embedded_in_apk';
  }
  if (pair.has('phone') && pair.has('domain')) return 'appears_with';
  return 'appears_with';
}

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType | 'case';
  risk: number;
  caseCount: number;
  data?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export function buildGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const entities = listEntities();
  const cases = listCases();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const edgeMap = new Map<string, GraphEdge>();

  for (const e of entities) {
    nodes.push({
      id: `e${e.id}`,
      label: e.value,
      type: e.type,
      risk: e.risk_score,
      caseCount: e.case_count ?? 0,
      data: { entityId: e.id, firstSeen: e.first_seen, lastSeen: e.last_seen },
    });
  }

  const links = db.prepare('SELECT case_id, entity_id FROM case_entities').all() as { case_id: string; entity_id: number }[];
  const byCase = new Map<string, number[]>();
  const byEntity = new Map<number, string[]>();
  for (const l of links) {
    if (!byCase.has(l.case_id)) byCase.set(l.case_id, []);
    byCase.get(l.case_id)!.push(l.entity_id);
    if (!byEntity.has(l.entity_id)) byEntity.set(l.entity_id, []);
    byEntity.get(l.entity_id)!.push(l.case_id);
  }

  for (const c of cases) {
    const entityIds = byCase.get(c.id) ?? [];
    // Only render case nodes that carry entities, keeping the graph investigative.
    if (!entityIds.length) continue;
    nodes.push({
      id: `c:${c.id}`,
      label: c.id,
      type: 'case',
      risk: c.risk_score,
      caseCount: 1,
      data: { caseId: c.id, title: c.title, status: c.status, source: c.source_type },
    });
    for (const eid of entityIds) {
      const key = `c:${c.id}->e${eid}`;
      edges.push({ id: key, source: `c:${c.id}`, target: `e${eid}`, relation: 'evidence_in', weight: 1 });
    }
    const entityById = new Map(entities.map((e) => [e.id, e]));
    const limit = Math.min(entityIds.length, 18);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const a = entityById.get(entityIds[i]);
        const b = entityById.get(entityIds[j]);
        if (!a || !b) continue;
        const key = [Math.min(a.id, b.id), Math.max(a.id, b.id)].join('-');
        const existing = edgeMap.get(key);
        if (existing) {
          existing.weight += 1;
        } else {
          const edge: GraphEdge = {
            id: `co:${key}`,
            source: `e${a.id}`,
            target: `e${b.id}`,
            relation: relationFor(a.type, b.type),
            weight: 1,
          };
          edgeMap.set(key, edge);
          edges.push(edge);
        }
      }
    }
  }

  return { nodes, edges };
}

export function stats() {
  const total = caseCount();
  const open = (db.prepare("SELECT COUNT(*) as c FROM cases WHERE status = 'open'").get() as { c: number }).c;
  const investigating = (db.prepare("SELECT COUNT(*) as c FROM cases WHERE status = 'investigating'").get() as { c: number }).c;
  const closed = (db.prepare("SELECT COUNT(*) as c FROM cases WHERE status = 'closed'").get() as { c: number }).c;
  const entityCount = (db.prepare('SELECT COUNT(*) as c FROM entities').get() as { c: number }).c;
  const high = (db.prepare("SELECT COUNT(*) as c FROM cases WHERE risk_label = 'HIGH'").get() as { c: number }).c;
  const medium = (db.prepare("SELECT COUNT(*) as c FROM cases WHERE risk_label = 'MEDIUM'").get() as { c: number }).c;
  const low = (db.prepare("SELECT COUNT(*) as c FROM cases WHERE risk_label = 'LOW'").get() as { c: number }).c;
  const reused = (db.prepare('SELECT COUNT(*) as c FROM (SELECT entity_id FROM case_entities GROUP BY entity_id HAVING COUNT(*) >= 2)').get() as {
    c: number;
  }).c;
  const avgRisk = (db.prepare('SELECT AVG(risk_score) as a FROM cases').get() as { a: number | null }).a ?? 0;

  const days = 30;
  const series: { date: string; cases: number; high: number }[] = [];
  const byDay = new Map<string, { cases: number; high: number }>();
  const caseRows = db.prepare('SELECT created_at, risk_label FROM cases').all() as { created_at: string; risk_label: string }[];
  for (const c of caseRows) {
    const day = c.created_at.slice(0, 10);
    const entry = byDay.get(day) ?? { cases: 0, high: 0 };
    entry.cases++;
    if (c.risk_label === 'HIGH') entry.high++;
    byDay.set(day, entry);
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const v = byDay.get(key) ?? { cases: 0, high: 0 };
    series.push({ date: key, cases: v.cases, high: v.high });
  }

  const topEntities = db
    .prepare(
      `SELECT e.*, COUNT(DISTINCT ce.case_id) as case_count
       FROM entities e JOIN case_entities ce ON ce.entity_id = e.id
       GROUP BY e.id HAVING case_count >= 1
       ORDER BY case_count DESC, e.risk_score DESC LIMIT 8`,
    )
    .all() as EntityRecord[];

  const recentCases = listCases().slice(0, 7);
  const recentEvents = events(10);
  const sources = db.prepare('SELECT source_type as source, COUNT(*) as count FROM cases GROUP BY source_type').all() as {
    source: string;
    count: number;
  }[];

  const trend = series.reduce((s, d) => s + d.cases, 0);

  return {
    totals: { cases: total, open, investigating, closed, entities: entityCount, high, medium, low, reused, avgRisk, trend },
    series,
    topEntities,
    recentCases,
    events: recentEvents,
    sources,
    risk: [
      { label: 'HIGH', value: high },
      { label: 'MEDIUM', value: medium },
      { label: 'LOW', value: low },
    ],
    generatedAt: nowIso(),
  };
}

export function createReport(caseId: string, analyst = 'Analyst — Cyber Crime Cell'): ReportPayload | null {
  const c = getCase(caseId);
  if (!c) return null;
  const relatedRows = db
    .prepare(
      `SELECT e.type, e.value, COUNT(DISTINCT ce.case_id) as cases
       FROM entities e
       JOIN case_entities ce ON ce.entity_id = e.id
       WHERE e.id IN (SELECT entity_id FROM case_entities WHERE case_id = ?)
       GROUP BY e.id ORDER BY cases DESC`,
    )
    .all(caseId) as { type: string; value: string; cases: number }[];

  const correlations: ReportPayload['correlations'] = [];
  for (const row of relatedRows.filter((r) => r.cases >= 2)) {
    const caseIds = db
      .prepare(
        `SELECT DISTINCT c.id, c.title FROM cases c JOIN case_entities ce ON ce.case_id = c.id
         JOIN entities e ON e.id = ce.entity_id WHERE e.type = ? AND e.value = ? ORDER BY c.created_at DESC`,
      )
      .all(row.type, row.value) as { id: string; title: string }[];
    correlations.push({ type: row.type, value: row.value, cases: caseIds.map((x) => `${x.id} · ${x.title}`) });
  }

  const analysisRows = c.analyses as { kind: string; result_json: any }[];
  const analysis = analysisRows[0]?.result_json ?? {};
  const rules = Array.isArray(analysis?.rules)
    ? analysis.rules
    : Array.isArray(analysis?.heuristics)
      ? analysis.heuristics
      : [];

  const entities = (c.entities ?? []).map((e) => {
    const row = db.prepare('SELECT COUNT(*) as c FROM case_entities WHERE entity_id = ?').get(e.id) as { c: number };
    return { type: e.type, value: e.value, cases: row.c, risk: e.risk_score };
  });

  const payloadCore = {
    case: c,
    analysis,
    rules,
    entities,
    correlations,
    timeline: c.events ?? [],
    notes: c.notes,
  };
  const hash = createHash('sha256').update(JSON.stringify(payloadCore)).digest('hex');

  const generatedAt = nowIso();
  const generatedAtIst = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(new Date());

  const payload: ReportPayload = {
    reportId: `RPT-${caseId.replace('TRC-', '')}-${Date.now().toString(36).toUpperCase()}`,
    case: c,
    generatedAt,
    generatedAtIst: `${generatedAtIst} IST`,
    analyst,
    analysis,
    rules,
    entities,
    correlations,
    timeline: c.events ?? [],
    notes: c.notes,
    methodology:
      'Deterministic rule-based analysis; no machine learning used. Every score is the sum of documented rule weights, capped at 100, with the triggering evidence retained verbatim.',
    integrityHash: hash,
  };

  db.prepare(
    'INSERT INTO reports (id, case_id, analyst, payload_json, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(payload.reportId, caseId, analyst, JSON.stringify(payload), hash, generatedAt);

  db.prepare('INSERT INTO events (case_id, type, message, created_at) VALUES (?, ?, ?, ?)').run(
    caseId,
    'report',
    `Report ${payload.reportId} generated`,
    generatedAt,
  );

  return payload;
}

export function listReports(): {
  id: string;
  case_id: string;
  analyst: string;
  payload_hash: string;
  created_at: string;
  title: string;
  risk_label: string;
}[] {
  return db
    .prepare(
      `SELECT r.id, r.case_id, r.analyst, r.payload_hash, r.created_at, c.title, c.risk_label
       FROM reports r JOIN cases c ON c.id = r.case_id ORDER BY r.created_at DESC`,
    )
    .all() as {
    id: string;
    case_id: string;
    analyst: string;
    payload_hash: string;
    created_at: string;
    title: string;
    risk_label: string;
  }[];
}

export function getReport(id: string): ReportPayload | null {
  const row = db.prepare('SELECT payload_json FROM reports WHERE id = ?').get(id) as { payload_json: string } | undefined;
  if (!row) return null;
  return safeJson(row.payload_json) as ReportPayload;
}
