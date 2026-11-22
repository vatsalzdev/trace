import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, GitBranch, Plus, X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { CaseRecord, EntityRecord, EntityType } from '@shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ENTITY_META, relativeTime, riskClass, shortDate } from '@/lib/format';
import { ENTITY_ICONS } from './EntityChip';
import { Button, Label, ScoreBar } from './ui';
import { useToast } from './Toast';

interface DrawerTarget {
  id?: number;
  type: EntityType;
  value: string;
}

const DrawerContext = createContext<{ open: (target: DrawerTarget) => void; close: () => void }>({
  open: () => {},
  close: () => {},
});

export function useEntityDrawer() {
  return useContext(DrawerContext);
}

interface Related {
  entity: EntityRecord;
  cases: (CaseRecord & { shared: number })[];
  neighbours: (EntityRecord & { co_occurrences: number })[];
}

export function EntityDrawerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<DrawerTarget | null>(null);
  const [related, setRelated] = useState<Related | null>(null);
  const [loading, setLoading] = useState(false);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [addTo, setAddTo] = useState('');
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const open = useCallback((next: DrawerTarget) => {
    setTarget(next);
    setRelated(null);
    setLoading(true);
  }, []);

  const close = useCallback(() => {
    setTarget(null);
    setRelated(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let id = target.id;
        if (!id) {
          const res = await api.entities({ q: target.value });
          const found = res.entities.find(
            (e) => e.type === target.type && e.value.toLowerCase() === target.value.toLowerCase(),
          );
          id = found?.id;
        }
        if (!id) {
          if (!cancelled) setRelated(null);
          return;
        }
        const res = await api.related(id);
        if (!cancelled) {
          setRelated(res);
          setAddTo('');
        }
      } catch {
        if (!cancelled) setRelated(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    api
      .cases()
      .then((r) => setCases(r.cases))
      .catch(() => setCases([]));
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [target, close]);

  const meta = target ? ENTITY_META[target.type] ?? ENTITY_META.domain : null;
  const Icon = target ? ENTITY_ICONS[target.type] ?? ENTITY_ICONS.domain : ENTITY_ICONS.domain;
  const reuse = related?.cases.length ?? 0;

  const handleAdd = async () => {
    if (!related || !addTo) return;
    setAdding(true);
    try {
      await api.addEntity(addTo, related.entity.id);
      toast(`Indicator linked to ${addTo}`, 'success');
      const refreshed = await api.related(related.entity.id);
      setRelated(refreshed);
      setAddTo('');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not link indicator', 'error');
    } finally {
      setAdding(false);
    }
  };

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <DrawerContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {target && (
          <motion.div
            key="entity-drawer"
            className="fixed inset-0 z-[150]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-0 bg-black/50" onClick={close} />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
              className="absolute right-0 top-0 flex h-full w-full max-w-[430px] flex-col border-l border-line bg-bg-1 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.9)]"
              role="dialog"
              aria-modal="true"
              aria-label="Entity details"
            >
              <header className="flex items-start gap-3 border-b border-line px-5 py-4">
                <span
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line"
                  style={{ color: meta?.color, background: `${meta?.color}0f` }}
                >
                  <Icon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="label">{meta?.label ?? 'Indicator'}</div>
                  <div className="mono mt-1 break-all text-[13px] leading-snug text-ink">{target.value}</div>
                </div>
                <button onClick={close} className="mt-0.5 text-ink-3 transition-colors hover:text-ink" aria-label="Close">
                  <X size={16} />
                </button>
              </header>

              <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                {loading && (
                  <div className="space-y-4">
                    <div className="h-16 animate-pulse rounded-lg bg-bg-2" />
                    <div className="h-24 animate-pulse rounded-lg bg-bg-2" />
                    <div className="h-32 animate-pulse rounded-lg bg-bg-2" />
                  </div>
                )}

                {!loading && !related && (
                  <div className="rounded-lg border border-line bg-bg-2 p-4">
                    <div className="text-[13px] font-medium text-ink">Not in the case index yet</div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
                      This indicator has been extracted from the current analysis but is not linked to a saved case. Save the
                      analysis as a case to add it to the correlation graph.
                    </p>
                  </div>
                )}

                {!loading && related && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <Label>Risk contribution</Label>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="num text-[34px] font-medium leading-none tracking-[-0.04em] text-ink">
                            {related.entity.risk_score}
                          </span>
                          <span className="mono text-[10px] text-ink-3">/100</span>
                        </div>
                      </div>
                      <span className={riskClass(related.entity.risk_score >= 60 ? 'HIGH' : related.entity.risk_score >= 30 ? 'MEDIUM' : 'LOW')}>
                        {related.entity.risk_score >= 60 ? 'HIGH' : related.entity.risk_score >= 30 ? 'MEDIUM' : 'LOW'}
                      </span>
                    </div>
                    <ScoreBar score={related.entity.risk_score} height={5} />

                    {reuse >= 2 && (
                      <div className="rounded-lg border border-accent/25 bg-accent/[0.06] px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="label text-accent/80">Reuse signal</div>
                          <span className="mono text-[10px] text-accent">SEEN IN {reuse} CASES</span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">
                          The same indicator appears in {reuse} separate case files. Reuse is the strongest pivot between
                          otherwise unconnected complaints.
                        </p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md border border-line bg-bg-2 px-3 py-2.5">
                        <div className="label">First seen</div>
                        <div className="mt-1 text-[11.5px] text-ink-2">{shortDate(related.entity.first_seen)}</div>
                      </div>
                      <div className="rounded-md border border-line bg-bg-2 px-3 py-2.5">
                        <div className="label">Last seen</div>
                        <div className="mt-1 text-[11.5px] text-ink-2">{relativeTime(related.entity.last_seen)}</div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <Label>Cases ({related.cases.length})</Label>
                        <span className="mono text-[10px] text-ink-3">{reuse >= 2 ? 'correlated' : 'single'}</span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {related.cases.map((c) => (
                          <Link
                            key={c.id}
                            to={`/app/cases/${c.id}`}
                            onClick={close}
                            className="group flex items-center gap-3 rounded-md border border-line bg-bg-2 px-3 py-2.5 transition-colors hover:border-line-2"
                          >
                            <span className="mono shrink-0 text-[10px] text-ink-3">{c.id}</span>
                            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2 group-hover:text-ink">{c.title}</span>
                            <span className={riskClass(c.risk_label)}>{c.risk_label}</span>
                          </Link>
                        ))}
                        {!related.cases.length && <div className="text-[12px] text-ink-3">No cases linked.</div>}
                      </div>
                    </div>

                    <div>
                      <Label>Linked entities ({related.neighbours.length})</Label>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {related.neighbours.slice(0, 14).map((n) => (
                          <button
                            key={n.id}
                            onClick={() => open({ id: n.id, type: n.type, value: n.value })}
                            className="entity-chip"
                            title={`${n.co_occurrences} shared case${n.co_occurrences === 1 ? '' : 's'}`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: ENTITY_META[n.type]?.color }} />
                            <span className="max-w-[190px] truncate">{n.value}</span>
                            <span className="mono text-[9px] text-ink-3">{n.co_occurrences}</span>
                          </button>
                        ))}
                        {!related.neighbours.length && <div className="text-[12px] text-ink-3">No co-occurring entities yet.</div>}
                      </div>
                    </div>

                    <div>
                      <Label>Add to case</Label>
                      <div className="mt-2 flex gap-2">
                        <select className="input h-9 flex-1 text-[12px]" value={addTo} onChange={(e) => setAddTo(e.target.value)}>
                          <option value="">Select a case…</option>
                          {cases.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.id} — {c.title.slice(0, 42)}
                            </option>
                          ))}
                        </select>
                        <Button onClick={handleAdd} disabled={!addTo || adding} className="h-9">
                          <Plus size={13} />
                          Link
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <footer className="flex items-center gap-2 border-t border-line px-5 py-4">
                <Button
                  variant="accent"
                  className="flex-1"
                  disabled={!related}
                  onClick={() => {
                    if (!related) return;
                    close();
                    navigate(`/app/graph?focus=e${related.entity.id}`);
                  }}
                >
                  <GitBranch size={13} />
                  View in graph
                </Button>
                <Button
                  className="flex-1"
                  disabled={!related}
                  onClick={() => {
                    if (!related) return;
                    close();
                    navigate(`/app/cases/${related.cases[0]?.id ?? ''}`);
                  }}
                >
                  <ArrowUpRight size={13} />
                  Open case
                </Button>
              </footer>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </DrawerContext.Provider>
  );
}
