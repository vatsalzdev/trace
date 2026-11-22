import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, FolderOpen, Plus, RefreshCw, Search } from 'lucide-react';
import type { CaseRecord } from '@shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useDebounce } from '@/lib/hooks';
import { Button, Card, EmptyState, Label, PageHeader, RiskPill } from '@/components/ui';

type Status = 'all' | 'open' | 'investigating' | 'closed';
type Source = 'all' | 'message' | 'url' | 'apk' | 'manual';

const SOURCE_LABEL: Record<string, string> = { message: 'MSG', url: 'URL', apk: 'APK', manual: 'MAN' };

const STATUS_STYLE: Record<string, string> = {
  open: 'border-accent/25 bg-accent/[0.06] text-accent',
  investigating: 'border-warn/25 bg-warn/[0.07] text-warn',
  closed: 'border-line bg-[var(--fill-1)] text-ink-3',
};

export default function Cases() {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [source, setSource] = useState<Source>('all');
  const [sort, setSort] = useState<'updated' | 'risk' | 'title'>('updated');
  const debounced = useDebounce(query, 200);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .cases({})
      .then((res) => {
        if (!cancelled) setCases(res.cases);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load cases');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const bySource: Record<Source, number> = { all: cases.length, message: 0, url: 0, apk: 0, manual: 0 };
    const byStatus: Record<Status, number> = { all: cases.length, open: 0, investigating: 0, closed: 0 };
    cases.forEach((c) => {
      if (c.source_type in bySource) bySource[c.source_type as Source] += 1;
      if (c.status in byStatus) byStatus[c.status as Status] += 1;
    });
    return { bySource, byStatus, high: cases.filter((c) => c.risk_label === 'HIGH').length };
  }, [cases]);

  const visible = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    const list = cases.filter((c) => {
      if (source !== 'all' && c.source_type !== source) return false;
      if (status !== 'all' && c.status !== status) return false;
      if (needle && !`${c.id} ${c.title} ${c.raw_input}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return [...list].sort((a, b) => {
      if (sort === 'risk') return (rank[b.risk_label] ?? 0) - (rank[a.risk_label] ?? 0) || b.risk_score - a.risk_score;
      if (sort === 'title') return a.title.localeCompare(b.title);
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [cases, source, status, debounced, sort]);

  const activeFilter = status !== 'all' || source !== 'all' || Boolean(debounced.trim());

  return (
    <div className="space-y-6">
      <PageHeader
        label="Case index"
        title="Every complaint is a file, not a ticket"
        description="Cases are opened from an analysis or linked indicator. Search the raw evidence, filter by status or source, and open the file to work the timeline."
        actions={
          <>
            <Link to="/app/scan" className="btn btn-primary h-8 text-[11.5px]">
              <Plus size={12} /> New analysis
            </Link>
            <button
              onClick={() => {
                setQuery('');
                setStatus('all');
                setSource('all');
              }}
              className="btn h-8 text-[11.5px]"
            >
              <RefreshCw size={12} /> Reset
            </button>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[184px_minmax(0,1fr)]">
        <Card className="p-3 lg:sticky lg:top-20">
          <Label>Category</Label>
          <div className="mt-3 space-y-1">
            {(
              [
                ['all', 'All cases'],
                ['message', 'Messages'],
                ['url', 'URLs'],
                ['apk', 'APKs'],
                ['manual', 'Manual'],
              ] as [Source, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSource(id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors',
                  source === id ? 'bg-accent/[0.08] text-ink' : 'text-ink-3 hover:bg-[var(--fill-1)] hover:text-ink-2',
                )}
              >
                <span className="flex-1 text-left">{label}</span>
                <span className="mono text-[9px] text-ink-3">{counts.bySource[id]}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <Label>Status</Label>
            <div className="mt-2 space-y-1">
              {(
                [
                  ['all', 'Any status'],
                  ['open', 'Open'],
                  ['investigating', 'Working'],
                  ['closed', 'Closed'],
                ] as [Status, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setStatus(id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors',
                    status === id ? 'bg-[var(--fill-5)] text-ink' : 'text-ink-3 hover:bg-[var(--fill-1)] hover:text-ink-2',
                  )}
                >
                  <span className="flex-1 text-left">{label}</span>
                  <span className="mono text-[9px] text-ink-3">{counts.byStatus[id]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mono mt-4 border-t border-line pt-3 text-[8.5px] uppercase tracking-[0.1em] text-ink-3">
            {counts.high} high-risk files
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, case ID or raw evidence…"
                className="input h-8 pl-8 text-[11.5px]"
                aria-label="Search cases"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="mono text-[8.5px] uppercase tracking-[0.1em] text-ink-3">sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="h-8 rounded-md border border-line bg-bg-1 px-2 text-[11px] text-ink-2 outline-none focus:border-accent/40"
                aria-label="Sort cases"
              >
                <option value="updated">Last updated</option>
                <option value="risk">Risk score</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </Card>

          {loading && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-[168px] animate-pulse rounded-lg border border-line bg-bg-1" />
              ))}
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-danger/25 bg-danger/[0.06] px-4 py-6 text-center text-[12px] text-danger/90">
              {error}
            </div>
          )}

          {!loading && !error && visible.length === 0 && (
            <EmptyState
              icon={<FolderOpen size={20} />}
              title={activeFilter ? 'No case matches this filter' : 'The index is empty'}
              description={
                activeFilter
                  ? 'Clear the search or widen the category and status filters.'
                  : 'Run a message, URL or APK analysis and save it as a case. Seeded data appears after the first API start.'
              }
              action={
                activeFilter ? (
                  <Button
                    onClick={() => {
                      setQuery('');
                      setStatus('all');
                      setSource('all');
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Link to="/app/scan" className="btn btn-primary">
                    Open the scanner
                  </Link>
                )
              }
            />
          )}

          {!loading && !error && visible.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((c) => (
                <Link
                  key={c.id}
                  to={`/app/cases/${c.id}`}
                  className="group flex min-h-[168px] flex-col rounded-lg border border-line bg-bg-1/60 p-4 transition-colors hover:border-line-2 hover:bg-[var(--fill-1)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="mono text-[9.5px] text-ink-3">{c.id}</span>
                    <span className="mono text-[8.5px] uppercase tracking-[0.08em] text-ink-3">
                      {SOURCE_LABEL[c.source_type] ?? c.source_type}
                    </span>
                  </div>
                  <div className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-ink-2 group-hover:text-ink">
                    {c.title}
                  </div>
                  <div className="mono mt-1.5 line-clamp-2 text-[9.5px] leading-relaxed text-ink-3/80">{c.raw_input}</div>
                  <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
                    <RiskPill label={c.risk_label} />
                    <span
                      className={cn(
                        'inline-flex h-[19px] items-center rounded border px-1.5 text-[9px] uppercase tracking-[0.08em]',
                        STATUS_STYLE[c.status],
                      )}
                    >
                      {c.status}
                    </span>
                    <span className="mono ml-auto text-[9px] text-ink-3">{c.entity_count ?? 0} ENT</span>
                  </div>
                  <div className="mono mt-2 flex items-center justify-between text-[8.5px] text-ink-3/70">
                    <span>{relativeTime(c.updated_at)}</span>
                    <ArrowUpRight size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
