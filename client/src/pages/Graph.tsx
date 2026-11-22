import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import {
  ArrowUpRight,
  Crosshair,
  FolderOpen,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { CaseRecord, EntityRecord, EntityType } from '@shared/types';
import { api, type GraphData } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ENTITY_META, relativeTime, riskClass } from '@/lib/format';
import { useEntityDrawer } from '@/components/EntityDrawer';
import { Button, Card, EmptyState, Label, PageHeader } from '@/components/ui';

type GType = EntityType | 'case';

interface GraphNodeData {
  label: string;
  type: GType;
  risk: number;
  caseCount: number;
  entityId?: number;
  caseId?: string;
  title?: string;
  status?: string;
  source?: string;
  firstSeen?: string;
  lastSeen?: string;
  selected?: boolean;
}

interface SimNode extends SimulationNodeDatum, GraphNodeData {
  id: string;
}

const EntityNode = memo(({ data, selected }: NodeProps<GraphNodeData>) => {
  const meta = ENTITY_META[data.type] ?? ENTITY_META.domain;
  return (
    <div
      className={cn(
        'group relative flex w-[156px] items-center gap-2 rounded-md border bg-bg-2 px-2.5 py-1.5 shadow-[0_8px_20px_-14px_rgba(0,0,0,0.9)] transition-colors',
        selected ? 'border-accent/60 bg-accent/[0.07]' : 'border-line hover:border-line-2',
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: meta.color }} />
      <div className="min-w-0 flex-1">
        <div className="mono truncate text-[10px] leading-tight text-ink-2">{data.label}</div>
        <div className="mono mt-0.5 flex items-center gap-1 text-[8px] uppercase tracking-[0.08em] text-ink-3">
          {meta.short}
          {data.caseCount >= 2 && <span className="text-accent">· {data.caseCount} cases</span>}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent" />
    </div>
  );
});

const CaseNode = memo(({ data, selected }: NodeProps<GraphNodeData>) => (
  <div
    className={cn(
      'relative flex w-[136px] items-center gap-2 rounded-md border bg-[#101014] px-2.5 py-1.5 transition-colors',
      selected ? 'border-ink/50' : 'border-line-2 hover:border-white/25',
    )}
  >
    <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-transparent" />
    <FolderOpen size={10} className="shrink-0 text-ink-3" />
    <div className="min-w-0 flex-1">
      <div className="mono truncate text-[9.5px] leading-tight text-ink">{data.label}</div>
      <div className="mono mt-0.5 text-[8px] uppercase tracking-[0.08em] text-ink-3">{data.status ?? 'case'}</div>
    </div>
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: data.risk >= 60 ? 'var(--danger)' : data.risk >= 30 ? 'var(--warn)' : 'var(--ok)' }}
    />
    <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-transparent" />
  </div>
));

const nodeTypes = { entity: EntityNode, case: CaseNode };

function layout(graph: GraphData): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  const simNodes: SimNode[] = graph.nodes.map((n, i) => ({
    id: n.id,
    label: n.label,
    type: n.type,
    risk: n.risk,
    caseCount: n.caseCount,
    entityId: typeof n.data?.entityId === 'number' ? (n.data.entityId as number) : undefined,
    caseId: typeof n.data?.caseId === 'string' ? (n.data.caseId as string) : undefined,
    title: typeof n.data?.title === 'string' ? (n.data.title as string) : undefined,
    status: typeof n.data?.status === 'string' ? (n.data.status as string) : undefined,
    source: typeof n.data?.source === 'string' ? (n.data.source as string) : undefined,
    firstSeen: typeof n.data?.firstSeen === 'string' ? (n.data.firstSeen as string) : undefined,
    lastSeen: typeof n.data?.lastSeen === 'string' ? (n.data.lastSeen as string) : undefined,
    x: Math.cos((i / Math.max(1, graph.nodes.length)) * Math.PI * 2) * 320 + (i % 7) * 6,
    y: Math.sin((i / Math.max(1, graph.nodes.length)) * Math.PI * 2) * 260 + (i % 5) * 5,
  }));

  const links: SimulationLinkDatum<SimNode>[] = graph.edges.map((e) => ({ source: e.source, target: e.target }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .force('charge', forceManyBody<SimNode>().strength(-110).distanceMax(520))
    .force('link', forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((d) => d.id).distance(86).strength(0.35))
    .force('center', forceCenter<SimNode>(0, 0))
    .force('collide', forceCollide<SimNode>().radius(46).iterations(2))
    .force('x', forceX<SimNode>(0).strength(0.03))
    .force('y', forceY<SimNode>(0).strength(0.03))
    .stop();

  for (let i = 0; i < 280; i++) simulation.tick();

  const xs = simNodes.map((n) => n.x ?? 0);
  const ys = simNodes.map((n) => n.y ?? 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min(1500 / spanX, 900 / spanY, 1.25);

  const nodes: Node<GraphNodeData>[] = simNodes.map((n) => ({
    id: n.id,
    type: n.type === 'case' ? 'case' : 'entity',
    position: {
      x: ((n.x ?? 0) - minX) * scale + 80,
      y: ((n.y ?? 0) - minY) * scale + 80,
    },
    data: {
      label: n.label,
      type: n.type,
      risk: n.risk,
      caseCount: n.caseCount,
      entityId: n.entityId,
      caseId: n.caseId,
      title: n.title,
      status: n.status,
      source: n.source,
      firstSeen: n.firstSeen,
      lastSeen: n.lastSeen,
    },
  }));

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'default',
    style: {
      stroke: e.relation === 'evidence_in' ? 'rgba(255,255,255,0.075)' : 'rgba(139,139,255,0.17)',
      strokeWidth: e.relation === 'evidence_in' ? 0.7 : Math.min(2, 0.8 + e.weight * 0.2),
    },
  }));

  return { nodes, edges };
}

function GraphInner() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showCases, setShowCases] = useState(true);
  const [sharedOnly, setSharedOnly] = useState(false);
  const [visibleTypes, setVisibleTypes] = useState<Set<GType>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isolate, setIsolate] = useState(false);
  const [related, setRelated] = useState<{
    cases: (CaseRecord & { shared: number })[];
    neighbours: (EntityRecord & { co_occurrences: number })[];
  } | null>(null);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const { getNode, setCenter, fitView } = useReactFlow();
  const { open } = useEntityDrawer();

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api
      .graph()
      .then((res) => {
        setGraph(res);
        const types = new Set<GType>();
        res.nodes.forEach((n) => {
          if (n.type !== 'case') types.add(n.type);
        });
        setVisibleTypes(types);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the graph'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const laidOut = useMemo(() => (graph ? layout(graph) : { nodes: [], edges: [] }), [graph]);

  const counts = useMemo(() => {
    const map = new Map<GType, number>();
    graph?.nodes.forEach((n) => map.set(n.type, (map.get(n.type) ?? 0) + 1));
    return map;
  }, [graph]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const nodes = laidOut.nodes.filter((n) => {
      const data = n.data!;
      if (data.type === 'case') {
        if (!showCases) return false;
        if (needle && !`${data.label} ${data.title ?? ''}`.toLowerCase().includes(needle)) return false;
        return true;
      }
      if (!visibleTypes.has(data.type)) return false;
      if (sharedOnly && data.caseCount < 2) return false;
      if (needle && !data.label.toLowerCase().includes(needle)) return false;
      return true;
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = laidOut.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const connected = new Set<string>();
    if (selectedId) {
      connected.add(selectedId);
      edges.forEach((e) => {
        if (e.source === selectedId) connected.add(e.target);
        if (e.target === selectedId) connected.add(e.source);
      });
    }
    const dim = isolate && Boolean(selectedId);
    return {
      nodes: nodes.map((n) => ({
        ...n,
        style: dim && !connected.has(n.id) ? { opacity: 0.15 } : undefined,
      })),
      edges: edges.map((e) => {
        const incident = Boolean(selectedId) && (e.source === selectedId || e.target === selectedId);
        return {
          ...e,
          style: {
            ...(e.style ?? {}),
            opacity: dim && !incident ? 0.15 : 1,
            stroke: incident ? 'rgba(139,139,255,0.95)' : (e.style?.stroke as string | undefined),
            strokeWidth: incident ? 2 : (e.style?.strokeWidth as number | undefined),
          },
        };
      }),
    };
  }, [laidOut, visibleTypes, showCases, sharedOnly, query, selectedId, isolate]);

  const selected = useMemo(
    () => laidOut.nodes.find((n) => n.id === selectedId) ?? null,
    [laidOut.nodes, selectedId],
  );

  useEffect(() => {
    if (!selected || selected.data?.type === 'case' || !selected.data?.entityId) {
      setRelated(null);
      return;
    }
    let cancelled = false;
    setRelatedLoading(true);
    api
      .related(selected.data.entityId)
      .then((res) => {
        if (!cancelled) setRelated({ cases: res.cases, neighbours: res.neighbours });
      })
      .catch(() => {
        if (!cancelled) setRelated(null);
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (!focus) return;
    setSelectedId(focus);
    const timer = window.setTimeout(() => {
      const node = getNode(focus);
      if (node) setCenter(node.position.x + 78, node.position.y + 20, { zoom: 1.15, duration: 700 });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [focus, getNode, setCenter, laidOut.nodes.length]);

  const toggleType = (type: GType) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const reset = () => {
    setQuery('');
    setShowCases(true);
    setSharedOnly(false);
    const types = new Set<GType>();
    graph?.nodes.forEach((n) => {
      if (n.type !== 'case') types.add(n.type);
    });
    setVisibleTypes(types);
    setSelectedId(null);
    setIsolate(false);
    fitView({ padding: 0.16, duration: 600 });
  };

  if (loading && !graph) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-64 animate-pulse rounded bg-bg-2" />
        <div className="h-[680px] animate-pulse rounded-xl border border-line bg-bg-2" />
      </div>
    );
  }

  if (error && !graph) {
    return (
      <EmptyState
        title="The graph could not be built"
        description={`${error}. Start the API and reload.`}
        action={<Button onClick={load}><RefreshCw size={13} /> Retry</Button>}
      />
    );
  }

  if (!graph) return null;

  const entityCount = graph.nodes.filter((n) => n.type !== 'case').length;
  const caseCount = graph.nodes.filter((n) => n.type === 'case').length;
  const shared = graph.nodes.filter((n) => n.type !== 'case' && n.caseCount >= 2).length;

  return (
    <div className="space-y-5">
      <PageHeader
        label="Relationship graph"
        title="Follow the indicator, not the story"
        description="Cases and indicators share one graph. Edges come from evidence links and co-occurrence inside the same case. A reused indicator is the strongest pivot between unrelated complaints."
        actions={
          <>
            <span className="mono hidden text-[9.5px] uppercase tracking-[0.1em] text-ink-3 sm:inline">
              {visible.nodes.length} visible · {visible.edges.length} edges
            </span>
            <Button onClick={reset} className="h-8 text-[11.5px]">
              <Crosshair size={12} /> Reset view
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-4 lg:grid-cols-4">
        <Metric label="Entity nodes" value={entityCount} />
        <Metric label="Case nodes" value={caseCount} />
        <Metric label="Reused indicators" value={shared} tone="accent" />
        <Metric label="Edges" value={graph.edges.length} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[168px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_300px]">
        <Card className="p-3 lg:sticky lg:top-20">
          <div className="flex items-center justify-between">
            <Label>Entity layers</Label>
            <SlidersHorizontal size={11} className="text-ink-3" />
          </div>
          <div className="mt-3 flex flex-wrap gap-1 lg:flex-col">
            {[...counts.entries()]
              .filter(([type]) => type !== 'case')
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={cn(
                    'flex items-center gap-2 rounded border px-2 py-1.5 text-[10px] transition-colors lg:w-full',
                    visibleTypes.has(type)
                      ? 'border-line-2 bg-white/[0.035] text-ink-2'
                      : 'border-line text-ink-3/50 hover:text-ink-3',
                  )}
                  title={`Toggle ${ENTITY_META[type as EntityType]?.label ?? type}`}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: visibleTypes.has(type) ? ENTITY_META[type as EntityType]?.color : 'var(--text-3)' }}
                  />
                  <span className="flex-1 truncate text-left">{ENTITY_META[type as EntityType]?.short ?? type}</span>
                  <span className="mono text-[8.5px] text-ink-3">{count}</span>
                </button>
              ))}
          </div>
          <div className="mt-4 space-y-1.5 border-t border-line pt-3">
            <button
              onClick={() => setShowCases((v) => !v)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-1 py-1 text-[10px] transition-colors',
                showCases ? 'text-ink-2' : 'text-ink-3/50',
              )}
            >
              <FolderOpen size={10} /> Case nodes
              <span className="mono ml-auto text-[8.5px]">{counts.get('case') ?? 0}</span>
            </button>
            <button
              onClick={() => setSharedOnly((v) => !v)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-1 py-1 text-[10px] transition-colors',
                sharedOnly ? 'text-accent' : 'text-ink-3/50',
              )}
            >
              <GitBranch size={10} /> Shared only
            </button>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by indicator or case…"
                className="h-7 w-[210px] rounded-md border border-line bg-bg-1 pl-7 pr-2 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-accent/40"
              />
            </div>
            <button
              onClick={() => setIsolate((v) => !v)}
              disabled={!selectedId}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[10.5px] transition-colors disabled:opacity-40',
                isolate ? 'border-accent/40 bg-accent/[0.07] text-accent' : 'border-line text-ink-3 hover:text-ink-2',
              )}
            >
              <Crosshair size={10} /> Isolate
            </button>
            <div className="ml-auto mono text-[9px] uppercase tracking-[0.1em] text-ink-3">click a node to pivot</div>
          </div>

          <div className="h-[620px] w-full">
            <ReactFlow
              nodes={visible.nodes}
              edges={visible.edges}
              nodeTypes={nodeTypes}
              onNodeClick={(_, node) => {
                setSelectedId(node.id);
                const data = node.data as GraphNodeData;
                if (data.type !== 'case' && data.entityId) {
                  open({ id: data.entityId, type: data.type as EntityType, value: data.label });
                }
              }}
              onPaneClick={() => setSelectedId(null)}
              minZoom={0.2}
              maxZoom={2.2}
              fitView
              fitViewOptions={{ padding: 0.16 }}
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
            >
              <Background color="rgba(255,255,255,0.055)" gap={26} size={1} />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeColor={(node) => {
                  const data = node.data as GraphNodeData;
                  return data.type === 'case' ? '#ededf0' : ENTITY_META[data.type as EntityType]?.color ?? '#5c5c66';
                }}
                maskColor="rgba(5,5,6,0.72)"
                style={{ background: '#0a0a0c', border: '1px solid rgba(255,255,255,0.07)' }}
              />
            </ReactFlow>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-[9.5px] text-ink-3">
              <span className="h-px w-5 bg-accent/40" /> co-occurrence
            </span>
            <span className="flex items-center gap-1.5 text-[9.5px] text-ink-3">
              <span className="h-px w-5 bg-white/20" /> evidence in case
            </span>
            <span className="mono ml-auto text-[9px] text-ink-3">
              {visible.nodes.length === 0 ? 'no nodes match this filter' : 'click a node to inspect'}
            </span>
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2 xl:col-span-1">
          {selected ? (
            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Label>{selected.data?.type === 'case' ? 'Case node' : ENTITY_META[selected.data?.type as EntityType]?.label ?? 'Indicator'}</Label>
                  <div className="mono mt-1 break-all text-[12px] leading-snug text-ink">{selected.data?.label}</div>
                  {selected.data?.title && <div className="mt-1 text-[11px] leading-snug text-ink-3">{selected.data.title}</div>}
                </div>
                <button onClick={() => setSelectedId(null)} className="text-ink-3 hover:text-ink" aria-label="Clear selection">
                  <X size={13} />
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <MiniStat label="Risk" value={`${selected.data?.risk ?? 0}`} />
                <MiniStat label="Cases" value={`${selected.data?.caseCount ?? 0}`} />
              </div>

              {selected.data?.type === 'case' ? (
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-ink-3">Status</span>
                    <span className="text-ink-2">{selected.data.status}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-ink-3">Source</span>
                    <span className="mono text-[10px] uppercase text-ink-2">{selected.data.source}</span>
                  </div>
                  {selected.data.caseId && (
                    <Link to={`/app/cases/${selected.data.caseId}`} className="btn btn-accent mt-2 w-full">
                      Open case file <ArrowUpRight size={12} />
                    </Link>
                  )}
                </div>
              ) : (
                <>
                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="accent"
                      className="flex-1"
                      onClick={() =>
                        open({
                          id: selected.data?.entityId,
                          type: selected.data?.type as EntityType,
                          value: selected.data?.label ?? '',
                        })
                      }
                    >
                      Open indicator
                    </Button>
                  </div>

                  {relatedLoading && (
                    <div className="mt-4 flex items-center gap-2 text-[10.5px] text-ink-3">
                      <Loader2 size={11} className="animate-spin" /> Loading linked cases…
                    </div>
                  )}

                  {!relatedLoading && related && (
                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="flex items-center justify-between">
                          <Label>Cases ({related.cases.length})</Label>
                          <span className="mono text-[8.5px] text-ink-3">evidence</span>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {related.cases.slice(0, 6).map((c) => (
                            <Link
                              key={c.id}
                              to={`/app/cases/${c.id}`}
                              className="group flex items-center gap-2 rounded border border-line bg-bg-1 px-2 py-1.5 transition-colors hover:border-line-2"
                            >
                              <span className="mono text-[9px] text-ink-3">{c.id}</span>
                              <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-2 group-hover:text-ink">{c.title}</span>
                              <span className={riskClass(c.risk_label)}>{c.risk_label}</span>
                            </Link>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between">
                          <Label>Co-occurs with ({related.neighbours.length})</Label>
                          <span className="mono text-[8.5px] text-ink-3">shared cases</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {related.neighbours.slice(0, 10).map((n) => (
                            <button
                              key={n.id}
                              onClick={() => open({ id: n.id, type: n.type, value: n.value })}
                              className="entity-chip max-w-full"
                              title={`${n.co_occurrences} shared case${n.co_occurrences === 1 ? '' : 's'}`}
                            >
                              <span className="h-1.5 w-1.5 rounded-full" style={{ background: ENTITY_META[n.type]?.color }} />
                              <span className="max-w-[150px] truncate">{n.value}</span>
                              <span className="mono text-[8.5px] text-ink-3">{n.co_occurrences}</span>
                            </button>
                          ))}
                          {!related.neighbours.length && <span className="text-[10.5px] text-ink-3">No co-occurrence yet.</span>}
                        </div>
                      </div>

                      <div className="mono border-t border-line pt-2 text-[8.5px] leading-relaxed text-ink-3">
                        FIRST SEEN {selected.data?.firstSeen ? relativeTime(selected.data.firstSeen) : '—'} · LAST SEEN{' '}
                        {selected.data?.lastSeen ? relativeTime(selected.data.lastSeen) : '—'}
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>
          ) : (
            <Card className="p-4">
              <Label>Inspect a node</Label>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                Click any entity to see every case it appears in, the indicators it co-occurs with, and its first and last
                observation. Drag nodes to rearrange; the layout is a deterministic force simulation.
              </p>
              <div className="mt-4 space-y-2 border-t border-line pt-3">
                {[...counts.entries()]
                  .filter(([type]) => type !== 'case')
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 6)
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ENTITY_META[type as EntityType]?.color }} />
                      <span className="flex-1 text-[11px] text-ink-3">{ENTITY_META[type as EntityType]?.label ?? type}</span>
                      <span className="mono text-[9px] text-ink-3">{count}</span>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Graph integrity</Label>
              <GitBranch size={13} className="text-ink-3" />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              Nodes are derived from the entity index, not drawn by hand. Edges are recomputed on every query from case
              evidence links and co-occurrence, so the graph cannot drift from the case files.
            </p>
            <div className="mono mt-3 flex items-center justify-between border-t border-line pt-2 text-[8.5px] text-ink-3">
              <span>{graph.nodes.length} NODES</span>
              <span>{graph.edges.length} EDGES</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'accent' }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={cn('num mt-1 text-[26px] font-medium leading-none tracking-[-0.04em]', tone === 'accent' ? 'text-accent' : 'text-ink')}>
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-bg-1 px-2.5 py-2">
      <div className="label">{label}</div>
      <div className="num mt-1 text-[15px] text-ink">{value}</div>
    </div>
  );
}

export default function Graph() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
