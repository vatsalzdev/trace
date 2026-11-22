import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Download,
  FileText,
  GitBranch,
  Loader2,
  Pencil,
  Save,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { EntityRecord } from '@shared/types';
import { api, type CaseDetail as CaseDetailType } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ENTITY_META, relativeTime, shortDate, shortDateTime } from '@/lib/format';
import { downloadReportPdf } from '@/lib/pdf';
import { useEntityDrawer } from '@/components/EntityDrawer';
import { EntityChip } from '@/components/EntityChip';
import { HighlightedText } from '@/components/HighlightedText';
import { useToast } from '@/components/Toast';
import {
  Button,
  Card,
  CopyButton,
  EmptyState,
  Label,
  RiskPill,
  RuleTable,
  ScoreBar,
  ScoreBlock,
  Tabs,
} from '@/components/ui';

type Tab = 'overview' | 'evidence' | 'indicators' | 'timeline' | 'notes';

const EVENT_COLOR: Record<string, string> = {
  created: 'var(--accent)',
  entities: 'var(--accent)',
  entity: 'var(--accent)',
  status: 'var(--warn)',
  note: 'var(--warn)',
  report: 'var(--ok)',
  viewed: 'var(--text-3)',
};

const SOURCE_LABEL: Record<string, string> = { message: 'Message', url: 'URL', apk: 'APK package', manual: 'Manual' };

export default function CaseDetail() {
  const { id = '' } = useParams();
  const [data, setData] = useState<CaseDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [entityIndex, setEntityIndex] = useState<Map<string, EntityRecord>>(new Map());
  const { open } = useEntityDrawer();
  const { toast } = useToast();
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    setError('');
    api
      .case(id)
      .then((res) => {
        setData(res.case);
        setTitleDraft(res.case.title);
        setNotesDraft(res.case.notes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load this case'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  useEffect(() => {
    api
      .entities()
      .then((res) => setEntityIndex(new Map(res.entities.map((e) => [`${e.type}:${e.value}`, e]))))
      .catch(() => {});
  }, []);

  const analysis = useMemo(() => {
    const raw = data?.analyses?.[0]?.result_json;
    return raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  }, [data]);

  const rules = useMemo(() => {
    if (Array.isArray(analysis.rules)) return analysis.rules;
    if (Array.isArray(analysis.heuristics)) return analysis.heuristics;
    return [];
  }, [analysis]);

  const triggered = useMemo(() => rules.filter((r: any) => r.triggered), [rules]);

  const entities = data?.entities ?? [];

  const shared = useMemo(() => {
    return entities
      .map((e) => ({ entity: e, count: Number(entityIndex.get(`${e.type}:${e.value}`)?.case_count ?? 0) }))
      .filter((x) => x.count >= 2)
      .sort((a, b) => b.count - a.count);
  }, [entities, entityIndex]);

  const setStatus = async (status: string) => {
    if (!data) return;
    try {
      const res = await api.patchCase(data.id, { status });
      setData(res.case);
      toast(`Status moved to ${status}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update status', 'error');
    }
  };

  const saveTitle = async () => {
    if (!data) return;
    const title = titleDraft.trim();
    if (!title || title === data.title) {
      setEditingTitle(false);
      setTitleDraft(data.title);
      return;
    }
    try {
      const res = await api.patchCase(data.id, { title });
      setData(res.case);
      setEditingTitle(false);
      toast('Case renamed', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not rename the case', 'error');
    }
  };

  const saveNotes = async () => {
    if (!data || savingNotes) return;
    setSavingNotes(true);
    try {
      const res = await api.patchCase(data.id, { notes: notesDraft });
      setData(res.case);
      toast('Analyst notes saved', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save notes', 'error');
    } finally {
      setSavingNotes(false);
    }
  };

  const generateReport = async () => {
    if (!data || reporting) return;
    setReporting(true);
    try {
      const res = await api.reportData(data.id);
      downloadReportPdf(res.report);
      setReportId(res.report.reportId);
      setData((prev) => (prev ? { ...prev, events: [{ id: Date.now(), case_id: prev.id, type: 'report', message: `Report ${res.report.reportId} generated`, created_at: new Date().toISOString() }, ...prev.events] } : prev));
      toast(`Report ${res.report.reportId} generated`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not generate the report', 'error');
    } finally {
      setReporting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-bg-2" />
        <div className="h-44 animate-pulse rounded-xl border border-line bg-bg-2" />
        <div className="h-80 animate-pulse rounded-xl border border-line bg-bg-2" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Case not found"
        description={error || `No case exists with the ID ${id}.`}
        action={
          <Button onClick={() => navigate('/app/cases')}>
            <ArrowLeft size={13} /> Back to cases
          </Button>
        }
      />
    );
  }

  const rawEntities = Array.isArray(analysis.entities) ? analysis.entities : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/app/cases" className="flex items-center gap-1.5 text-[11.5px] text-ink-3 transition-colors hover:text-ink">
          <ArrowLeft size={12} /> Cases
        </Link>
        <span className="text-ink-3/40">/</span>
        <span className="mono text-[10px] text-ink-3">{data.id}</span>
        <span className="ml-auto flex items-center gap-2">
          <RiskPill label={data.risk_label} score={data.risk_score} />
          <span className="mono rounded border border-line px-2 py-1 text-[9px] uppercase tracking-[0.08em] text-ink-3">
            {data.source_type}
          </span>
        </span>
      </div>

      <div className="flex flex-col justify-between gap-4 border-b border-line pb-5 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="label">Case file</div>
          {editingTitle ? (
            <div className="mt-1 flex items-center gap-2">
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  if (e.key === 'Escape') {
                    setEditingTitle(false);
                    setTitleDraft(data.title);
                  }
                }}
                onBlur={saveTitle}
                className="input h-10 max-w-[640px] text-[18px]"
              />
              <button onClick={saveTitle} className="text-ok" aria-label="Save title"><Check size={15} /></button>
              <button
                onClick={() => {
                  setEditingTitle(false);
                  setTitleDraft(data.title);
                }}
                className="text-ink-3 hover:text-ink"
                aria-label="Cancel"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="group mt-1 flex items-start gap-2 text-left"
              title="Rename case"
            >
              <h1 className="max-w-[900px] text-[26px] font-medium leading-tight tracking-[-0.03em] text-ink">{data.title}</h1>
              <Pencil size={12} className="mt-1.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
            <span>Opened {shortDate(data.created_at)}</span>
            <span>Updated {relativeTime(data.updated_at)}</span>
            <span>{data.entity_count ?? entities.length} indicators</span>
            <span>{data.events?.length ?? 0} events</span>
            <span className="mono text-[9.5px]">REPORT {reportId ?? 'not generated'}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            value={data.status}
            onChange={(e) => setStatus(e.target.value)}
            className="input h-8 w-[142px] text-[11.5px]"
            aria-label="Case status"
          >
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="closed">Closed</option>
          </select>
          <Button variant="primary" onClick={generateReport} disabled={reporting} className="h-8 text-[11.5px]">
            {reporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {reporting ? 'Building…' : 'Report PDF'}
          </Button>
          <Button className="h-8 text-[11.5px]" onClick={() => navigate(`/app/graph?focus=c:${data.id}`)}>
            <GitBranch size={12} /> Graph
          </Button>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-[64ch]">
                <Label>Verdict</Label>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                  {analysis.summary ||
                    `${data.risk_label} risk case scoring ${data.risk_score}/100. ${triggered.length} deterministic checks fired and ${entities.length} indicators were linked.`}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[9.5px] text-ink-3">
                    {triggered.length} RULES
                  </span>
                  <span className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[9.5px] text-ink-3">
                    {entities.length} INDICATORS
                  </span>
                  <span className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[9.5px] text-ink-3">
                    {shared.length} REUSED
                  </span>
                  <span className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[9.5px] text-ink-3">
                    {SOURCE_LABEL[data.source_type] ?? data.source_type}
                  </span>
                </div>
              </div>
              <div className="flex items-end gap-3">
                <ScoreBlock score={data.risk_score} label={data.risk_label} />
              </div>
            </div>
            <div className="mt-5">
              <ScoreBar score={data.risk_score} segments={30} height={7} />
            </div>
          </Card>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'overview', label: 'Overview', count: triggered.length },
              { value: 'evidence', label: 'Evidence' },
              { value: 'indicators', label: 'Entities', count: entities.length },
              { value: 'timeline', label: 'Timeline', count: data.events?.length ?? 0 },
              { value: 'notes', label: 'Notes' },
            ]}
          />

          {tab === 'overview' && (
            <div className="space-y-5">
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <Label>Rule ledger</Label>
                  <span className="mono text-[9px] text-ink-3">{rules.length} CHECKS · {triggered.length} FIRED</span>
                </div>
                <div className="mt-3">
                  <RuleTable rules={rules} />
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Indicators</Label>
                    <div className="mt-0.5 text-[12px] text-ink-3">Click one to open its full correlation record.</div>
                  </div>
                  <button onClick={() => setTab('indicators')} className="text-[11px] text-ink-3 hover:text-ink">
                    See all
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {entities.slice(0, 28).map((entity) => {
                    const count = Number(entityIndex.get(`${entity.type}:${entity.value}`)?.case_count ?? 0);
                    return (
                      <span key={entity.id} className="inline-flex items-center gap-1">
                        <EntityChip type={entity.type} value={entity.value} entityId={entity.id} />
                        {count >= 2 && (
                          <span className="mono rounded border border-accent/25 bg-accent/[0.06] px-1 text-[8.5px] text-accent">
                            {count}
                          </span>
                        )}
                      </span>
                    );
                  })}
                  {!entities.length && <div className="text-[12px] text-ink-3">No indicators linked to this case.</div>}
                </div>
              </Card>

              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Reuse signals</Label>
                    <div className="mt-0.5 text-[12px] text-ink-3">Indicators in this file that appear elsewhere in the index.</div>
                  </div>
                  <span className="mono text-[9px] text-ink-3">{shared.length}</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {shared.slice(0, 8).map(({ entity, count }) => (
                    <button
                      key={entity.id}
                      onClick={() => open({ id: entity.id, type: entity.type, value: entity.value })}
                      className="group flex w-full items-center gap-2 rounded-md border border-line bg-bg-1 px-3 py-2 text-left transition-colors hover:border-line-2"
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ENTITY_META[entity.type]?.color }} />
                      <span className="mono min-w-0 flex-1 truncate text-[10.5px] text-ink-2 group-hover:text-ink">{entity.value}</span>
                      <span className="mono text-[9px] text-ink-3">{ENTITY_META[entity.type]?.short}</span>
                      <span className="mono rounded border border-accent/25 bg-accent/[0.06] px-1 text-[9px] text-accent">
                        {count} cases
                      </span>
                      <ArrowUpRight size={11} className="text-ink-3 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                  {!shared.length && (
                    <div className="rounded-md border border-line bg-bg-1 px-3 py-3 text-[11.5px] leading-relaxed text-ink-3">
                      No indicator in this case appears in another case yet. Correlation strengthens as related complaints are
                      ingested.
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}

          {tab === 'evidence' && (
            <div className="space-y-5">
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Original input</Label>
                    <div className="mt-0.5 text-[12px] text-ink-3">Stored verbatim. Never rewritten or summarised in place.</div>
                  </div>
                  <CopyButton value={data.raw_input} label="Copy evidence" />
                </div>
                <div className="mono mt-4 max-h-[440px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-[#08080a] px-4 py-3.5 text-[11.5px] leading-relaxed text-ink-2">
                  {data.source_type === 'message' && rawEntities.length ? (
                    <HighlightedText text={data.raw_input} entities={rawEntities} />
                  ) : (
                    data.raw_input
                  )}
                </div>
              </Card>

              {analysis.breakdown && (
                <Card className="p-5">
                  <Label>URL breakdown</Label>
                  <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {Object.entries(analysis.breakdown).map(([key, value]) => (
                      <div key={key} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-2">
                        <span className="text-[10.5px] capitalize text-ink-3">{key}</span>
                        <span className="mono break-all text-right text-[10.5px] text-ink-2">{String(value || '—')}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {Array.isArray(analysis.keywords) && analysis.keywords.length > 0 && (
                <Card className="p-5">
                  <Label>Matched language</Label>
                  <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {analysis.keywords.map((group: any) => (
                      <div key={group.category}>
                        <div className="flex items-center gap-2">
                          <span className="h-1 w-1 rounded-full bg-accent/70" />
                          <span className="text-[11px] text-ink-2">{group.category}</span>
                          <span className="mono ml-auto text-[9px] text-ink-3">{group.matches.length}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {group.matches.map((match: string, i: number) => (
                            <span key={`${match}-${i}`} className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[9.5px] text-ink-3">
                              {match}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {analysis.packageName && (
                <Card className="p-5">
                  <Label>Package metadata</Label>
                  <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {[
                      ['Package', analysis.packageName],
                      ['Version', `${analysis.versionName} (${analysis.versionCode})`],
                      ['Min SDK', analysis.minSdk],
                      ['Target SDK', analysis.targetSdk],
                      ['SHA-256', analysis.sha256],
                      ['MD5', analysis.md5],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-2">
                        <span className="shrink-0 text-[10.5px] text-ink-3">{label}</span>
                        <span className="mono break-all text-right text-[10px] text-ink-2">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}

          {tab === 'indicators' && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <Label>Linked indicators ({entities.length})</Label>
                  <div className="mt-0.5 text-[12px] text-ink-3">Normalised values in the entity index.</div>
                </div>
                <span className="mono text-[9px] text-ink-3">{shared.length} REUSED</span>
              </div>
              <div className="divide-y divide-line/70">
                {entities.map((entity) => {
                  const count = Number(entityIndex.get(`${entity.type}:${entity.value}`)?.case_count ?? 0);
                  return (
                    <button
                      key={entity.id}
                      onClick={() => open({ id: entity.id, type: entity.type, value: entity.value })}
                      className="group flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ENTITY_META[entity.type]?.color }} />
                      <span className="mono w-[72px] shrink-0 text-[8.5px] uppercase tracking-[0.08em] text-ink-3">
                        {ENTITY_META[entity.type]?.short}
                      </span>
                      <span className="mono min-w-0 flex-1 truncate text-[11px] text-ink-2 group-hover:text-ink">{entity.value}</span>
                      <span className="mono text-[9.5px] text-ink-3">{count >= 2 ? `${count} cases` : '1 case'}</span>
                      <span className="mono text-[9.5px] text-ink-3">{entity.risk_score}</span>
                      <ArrowUpRight size={11} className="text-ink-3 opacity-0 group-hover:opacity-100" />
                    </button>
                  );
                })}
                {!entities.length && <div className="px-5 py-8 text-[12px] text-ink-3">No indicators linked.</div>}
              </div>
            </Card>
          )}

          {tab === 'timeline' && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <Label>Investigation timeline</Label>
                <span className="mono text-[9px] text-ink-3">{data.events?.length ?? 0} EVENTS</span>
              </div>
              <div className="mt-4">
                {(data.events ?? []).map((event, i) => (
                  <div key={event.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: EVENT_COLOR[event.type] ?? 'var(--text-3)' }} />
                      {i < (data.events?.length ?? 0) - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-[12px] text-ink-2">{event.message}</span>
                        <span className="mono text-[9px] text-ink-3">{shortDateTime(event.created_at)}</span>
                      </div>
                      <div className="mono mt-0.5 text-[8.5px] uppercase tracking-[0.08em] text-ink-3">
                        {event.type} · {relativeTime(event.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
                {!data.events?.length && <div className="text-[12px] text-ink-3">No events recorded.</div>}
              </div>
            </Card>
          )}

          {tab === 'notes' && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Analyst notes</Label>
                  <div className="mt-0.5 text-[12px] text-ink-3">Verification steps, callbacks and escalation decisions. Saved with the case and included in reports.</div>
                </div>
                <span className="mono text-[9px] text-ink-3">{notesDraft.length} CHARS</span>
              </div>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                placeholder="Record verification steps, callbacks, victim contact or escalation decisions…"
                className="mt-4 h-[260px] w-full resize-none rounded-md border border-line bg-[#08080a] px-3 py-2.5 text-[12px] leading-relaxed text-ink-2 outline-none placeholder:text-ink-3 focus:border-accent/40"
              />
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                <span className="mono text-[9px] text-ink-3">
                  {notesDraft === data.notes ? 'SAVED IN CASE FILE' : 'UNSAVED CHANGES'}
                </span>
                <Button onClick={saveNotes} disabled={savingNotes || notesDraft === data.notes}>
                  {savingNotes ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save notes
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-20">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Case metadata</Label>
              <FileText size={13} className="text-ink-3" />
            </div>
            <div className="mt-3 space-y-2.5">
              <Meta label="Case ID" value={data.id} mono copy />
              <Meta label="Source" value={SOURCE_LABEL[data.source_type] ?? data.source_type} />
              <Meta label="Created" value={shortDate(data.created_at)} />
              <Meta label="Updated" value={relativeTime(data.updated_at)} />
              <Meta label="Risk" value={`${data.risk_score}/100`} />
              <Meta label="Entities" value={String(data.entity_count ?? entities.length)} />
            </div>
            <div className="mt-4 border-t border-line pt-3">
              <Label>Actions</Label>
              <div className="mt-2 space-y-2">
                <Button variant="primary" className="w-full" onClick={generateReport} disabled={reporting}>
                  {reporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {reporting ? 'Building report…' : 'Generate report PDF'}
                </Button>
                <Button className="w-full" onClick={() => navigate(`/app/graph?focus=c:${data.id}`)}>
                  <GitBranch size={13} /> Focus in graph
                </Button>
              </div>
              {reportId && (
                <div className="mt-3 rounded-md border border-ok/25 bg-ok/[0.06] px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-[10.5px] text-ok">
                    <CheckCircle2 size={11} /> Latest report
                  </div>
                  <div className="mono mt-1 break-all text-[9.5px] text-ink-2">{reportId}</div>
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Analyst notes</Label>
              <ShieldAlert size={13} className="text-ink-3" />
            </div>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="Record verification steps, callbacks, victim contact or escalation decisions…"
              className="mt-2 h-[132px] w-full resize-none rounded-md border border-line bg-[#08080a] px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-2 outline-none placeholder:text-ink-3 focus:border-accent/40"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="mono text-[8.5px] text-ink-3">{notesDraft.length} chars</span>
              <Button onClick={saveNotes} disabled={savingNotes || notesDraft === data.notes} className="h-7 text-[10.5px]">
                {savingNotes ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                Save notes
              </Button>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Correlation</Label>
              <span className="mono text-[9px] text-ink-3">{shared.length}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              {shared.length
                ? `${shared.length} indicator${shared.length === 1 ? '' : 's'} in this file appear elsewhere. Reuse is the strongest pivot between complaints.`
                : 'No indicator in this file is reused in another case yet.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-1">
              {shared.slice(0, 6).map(({ entity, count }) => (
                <button
                  key={entity.id}
                  onClick={() => open({ id: entity.id, type: entity.type, value: entity.value })}
                  className="entity-chip"
                  title={`${count} cases`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: ENTITY_META[entity.type]?.color }} />
                  <span className="max-w-[170px] truncate">{entity.value}</span>
                  <span className="mono text-[8.5px] text-accent">{count}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[10.5px] text-ink-3">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn('break-all text-right text-[11px] text-ink-2', mono && 'mono')}>{value}</span>
        {copy && <CopyButton value={value} label="" />}
      </span>
    </div>
  );
}
