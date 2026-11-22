import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { api, type StatsResponse } from '@/lib/api';
import { ENTITY_META, relativeTime, riskClass, shortDate } from '@/lib/format';
import { useEntityDrawer } from '@/components/EntityDrawer';
import { Button, Card, EmptyState, Label, RiskPill, Segmented, StatBlock } from '@/components/ui';

const SOURCE_LABEL: Record<string, string> = { message: 'MSG', url: 'URL', apk: 'APK', manual: 'MAN' };

const EVENT_DOT: Record<string, string> = {
  created: 'var(--accent)',
  entities: 'var(--accent)',
  entity: 'var(--accent)',
  status: 'var(--warn)',
  note: 'var(--warn)',
  report: 'var(--ok)',
  viewed: 'var(--text-3)',
};

export default function CommandCenter() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { open } = useEntityDrawer();

  const load = () => {
    setLoading(true);
    setError('');
    api
      .stats()
      .then((res) => setStats(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not reach the API'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const series = useMemo(() => {
    if (!stats) return [];
    if (range === '7d') return stats.series.slice(-7);
    return stats.series;
  }, [stats, range]);

  const maxReuse = Math.max(1, ...(stats?.topEntities.map((e) => Number(e.case_count ?? 0)) ?? [1]));

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-56 animate-pulse rounded bg-bg-2" />
        <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-line bg-bg-2" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="h-80 animate-pulse rounded-xl border border-line bg-bg-2" />
          <div className="h-80 animate-pulse rounded-xl border border-line bg-bg-2" />
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <EmptyState
        title="The index is unreachable"
        description={`${error}. Start the API with npm run dev and reload.`}
        action={<Button onClick={load}><RefreshCw size={13} /> Retry</Button>}
      />
    );
  }

  if (!stats) return null;

  const t = stats.totals;
  const rangeLabel = range === '7d' ? 'Last 7 days' : range === '30d' ? 'Last 30 days' : 'All indexed time';

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="label">Console</div>
          <h1 className="mt-1 text-[28px] font-medium tracking-[-0.035em] text-ink">Command Center</h1>
          <p className="mt-1 text-[12px] text-ink-3">
            {rangeLabel} · {t.cases} cases indexed · last refresh {relativeTime(stats.generatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: '7d', label: '7D' },
              { value: '30d', label: '30D' },
              { value: 'all', label: 'All' },
            ]}
          />
          <button onClick={load} className="text-ink-3 transition-colors hover:text-ink" title="Refresh index" aria-label="Refresh index">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <StatBlock
          label="Cases indexed"
          value={t.cases}
          spark={stats.series.map((s) => s.cases)}
          hint={`${t.open} open · ${t.investigating} investigating · ${t.closed} closed`}
        />
        <StatBlock
          label="High risk"
          value={t.high}
          tone="danger"
          spark={stats.series.map((s) => s.high)}
          hint={`${t.medium} medium · ${t.low} low`}
        />
        <StatBlock
          label="Reused indicators"
          value={t.reused}
          tone="accent"
          spark={stats.topEntities.map((e) => Number(e.case_count ?? 0))}
          hint="Appearing in two or more cases"
        />
        <StatBlock
          label="Weighted mean risk"
          value={Math.round(t.avgRisk)}
          suffix="/100"
          spark={stats.series.map((s) => s.cases * 8)}
          hint="Mean of case scores, not a probability"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <Label>Threat activity</Label>
                <div className="mt-1 text-[13px] text-ink-2">Cases opened per day</div>
              </div>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[10px] text-ink-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" /> all cases
                </span>
                <span className="flex items-center gap-1.5 text-[10px] text-ink-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-danger" /> high risk
                </span>
              </div>
            </div>
            <div className="mt-5 h-[238px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id="casesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="highFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="var(--danger)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--grid-line)" strokeDasharray="0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                    dy={6}
                  />
                  <YAxis hide domain={[0, 'dataMax + 1']} />
                  <Tooltip
                    cursor={{ stroke: 'var(--line-2)', strokeWidth: 1 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-md border border-line-2 bg-raised px-3 py-2 shadow-xl">
                          <div className="mono text-[9px] uppercase tracking-wider text-ink-3">
                            {shortDate(String(label))}
                          </div>
                          {payload.map((p) => (
                            <div key={String(p.dataKey)} className="mt-1 flex items-center gap-2 text-[11px] text-ink-2">
                              <span className="h-1 w-1 rounded-full" style={{ background: p.color }} />
                              <span className="capitalize">{String(p.dataKey)}</span>
                              <span className="mono ml-auto text-ink">{p.value as number}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Area type="monotone" dataKey="cases" stroke="var(--accent)" strokeWidth={1.5} fill="url(#casesFill)" dot={false} activeDot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="high" stroke="var(--danger)" strokeWidth={1.5} fill="url(#highFill)" dot={false} activeDot={{ r: 3, fill: 'var(--danger)', strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <span className="mono text-[9.5px] text-ink-3">
                {series.reduce((sum, s) => sum + s.cases, 0)} cases in window
              </span>
              <span className="mono text-[9.5px] text-ink-3">daily buckets · UTC</span>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <Label>Recent cases</Label>
                <div className="mt-0.5 text-[12px] text-ink-3">Newest first, all sources</div>
              </div>
              <Link to="/app/cases" className="flex items-center gap-1 text-[11px] text-ink-3 transition-colors hover:text-ink">
                All cases <ArrowUpRight size={11} />
              </Link>
            </div>
            <div className="grid grid-cols-[92px_1fr_44px_56px_38px_46px] items-center gap-3 border-b border-line px-5 py-2">
              {['CASE', 'TITLE', 'SOURCE', 'RISK', 'ENT', 'AGE'].map((h) => (
                <span key={h} className="mono text-[9px] uppercase tracking-[0.1em] text-ink-3">
                  {h}
                </span>
              ))}
            </div>
            <div>
              {stats.recentCases.map((c) => (
                <button
                  key={c.id}
                  onClick={() => navigate(`/app/cases/${c.id}`)}
                  className="row-hover group grid w-full grid-cols-[92px_1fr_44px_56px_38px_46px] items-center gap-3 border-b border-line/70 px-5 py-2.5 text-left transition-colors last:border-0 hover:bg-[var(--fill-1)]"
                >
                  <span className="mono text-[9.5px] text-ink-3 group-hover:text-ink-2">{c.id}</span>
                  <span className="min-w-0 truncate text-[12px] text-ink-2 group-hover:text-ink">{c.title}</span>
                  <span className="mono text-[8.5px] text-ink-3">{SOURCE_LABEL[c.source_type] ?? c.source_type}</span>
                  <span><RiskPill label={c.risk_label} /></span>
                  <span className="mono text-[10px] text-ink-3">{c.entity_count ?? 0}</span>
                  <span className="mono text-[9.5px] text-ink-3">{relativeTime(c.updated_at)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <Label>Top recurring entities</Label>
              <span className="mono text-[9px] text-ink-3">REUSE</span>
            </div>
            <div className="mt-3 space-y-3">
              {stats.topEntities.map((entity) => (
                <button
                  key={entity.id}
                  onClick={() => open({ id: entity.id, type: entity.type, value: entity.value })}
                  className="group block w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ENTITY_META[entity.type]?.color }} />
                    <span className="mono min-w-0 flex-1 truncate text-[11px] text-ink-2 group-hover:text-ink">{entity.value}</span>
                    <span className="mono text-[9px] text-ink-3">{ENTITY_META[entity.type]?.short}</span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 pl-3.5">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--fill-5)]">
                      <div
                        className="h-full rounded-full bg-accent/60 transition-[width] duration-500 ease-expo"
                        style={{ width: `${(Number(entity.case_count ?? 0) / maxReuse) * 100}%` }}
                      />
                    </div>
                    <span className="mono w-[44px] text-right text-[9px] text-ink-3">
                      {entity.case_count} case{Number(entity.case_count) === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <p className="mt-4 border-t border-line pt-3 text-[10.5px] leading-relaxed text-ink-3">
              Reuse across cases is the pivot. Open an indicator to see every file it appears in.
            </p>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <Label>Live feed</Label>
              <span className="flex items-center gap-1.5 mono text-[9px] uppercase tracking-wider text-ink-3">
                <span className="pulse-dot h-1 w-1 rounded-full bg-ok" /> events
              </span>
            </div>
            <div className="mt-3 space-y-0">
              {stats.events.map((event) => (
                <div key={event.id} className="flex gap-2.5 border-b border-line/60 py-2.5 last:border-0">
                  <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: EVENT_DOT[event.type] ?? 'var(--text-3)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] leading-snug text-ink-2">{event.message}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Link to={`/app/cases/${event.case_id}`} className="mono text-[8.5px] text-ink-3 transition-colors hover:text-ink">
                        {event.case_id}
                      </Link>
                      <span className="mono text-[8.5px] text-ink-3/70">{relativeTime(event.created_at)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
