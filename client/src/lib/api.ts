import type {
  ApkAnalysis,
  CaseRecord,
  EntityRecord,
  EntityType,
  EventRecord,
  MessageAnalysis,
  ReportPayload,
  UrlAnalysis,
} from '@shared/types';

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface StatsResponse {
  ok: boolean;
  totals: {
    cases: number;
    open: number;
    investigating: number;
    closed: number;
    entities: number;
    high: number;
    medium: number;
    low: number;
    reused: number;
    avgRisk: number;
    trend: number;
  };
  series: { date: string; cases: number; high: number }[];
  topEntities: EntityRecord[];
  recentCases: CaseRecord[];
  events: (EventRecord & { case_title?: string })[];
  sources: { source: string; count: number }[];
  risk: { label: string; value: number }[];
  generatedAt: string;
}

export type CaseDetail = CaseRecord & {
  entities: EntityRecord[];
  analyses: { id: number; kind: string; input: string; result_json: unknown; created_at: string }[];
  events: EventRecord[];
};

export interface GraphData {
  ok: boolean;
  nodes: {
    id: string;
    label: string;
    type: EntityType | 'case';
    risk: number;
    caseCount: number;
    data?: Record<string, unknown>;
  }[];
  edges: { id: string; source: string; target: string; relation: string; weight: number }[];
}

export const api = {
  stats: () => request<StatsResponse>('/stats'),
  cases: (params: { status?: string; source?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.source) qs.set('source', params.source);
    if (params.q) qs.set('q', params.q);
    return request<{ ok: boolean; cases: CaseRecord[] }>(`/cases?${qs.toString()}`);
  },
  case: (id: string) => request<{ ok: boolean; case: CaseDetail }>(`/cases/${id}`),
  patchCase: (id: string, patch: { status?: string; notes?: string; title?: string }) =>
    request<{ ok: boolean; case: CaseDetail }>(`/cases/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  createCase: (body: { source_type: string; raw_input: string; title?: string; notes?: string; sha256?: string }) =>
    request<{ ok: boolean; case: CaseRecord; caseId: string }>('/cases', { method: 'POST', body: JSON.stringify(body) }),
  analyzeMessage: (text: string, opts: { save?: boolean; title?: string } = {}) =>
    request<{ ok: boolean; analysis: MessageAnalysis; entities: unknown[]; caseId?: string }>('/analyze/message', {
      method: 'POST',
      body: JSON.stringify({ text, ...opts }),
    }),
  analyzeUrl: (url: string, opts: { save?: boolean; title?: string; deepScan?: boolean } = {}) =>
    request<{ ok: boolean; analysis: UrlAnalysis & { enrichment?: unknown }; caseId?: string }>('/analyze/url', {
      method: 'POST',
      body: JSON.stringify({ url, ...opts }),
    }),
  entities: (params: { q?: string; type?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.type) qs.set('type', params.type);
    return request<{ ok: boolean; entities: EntityRecord[] }>(`/entities?${qs.toString()}`);
  },
  related: (id: number) =>
    request<{
      ok: boolean;
      entity: EntityRecord;
      cases: (CaseRecord & { shared: number })[];
      neighbours: (EntityRecord & { co_occurrences: number })[];
    }>(`/entities/${id}/related`),
  addEntity: (caseId: string, entityId: number) =>
    request<{ ok: boolean; case: CaseDetail }>(`/cases/${caseId}/entities`, {
      method: 'POST',
      body: JSON.stringify({ entityId }),
    }),
  graph: () => request<GraphData>('/graph'),
  reportData: (caseId: string) =>
    request<{ ok: boolean; report: ReportPayload }>(`/cases/${caseId}/report-data`, { method: 'POST', body: '{}' }),
  reports: () =>
    request<{
      ok: boolean;
      reports: { id: string; case_id: string; analyst: string; payload_hash: string; created_at: string; title: string; risk_label: string }[];
    }>('/reports'),
  report: (id: string) => request<{ ok: boolean; report: ReportPayload }>(`/reports/${id}`),
};

export function analyzeApkFile(
  file: File | null,
  opts: { sample?: boolean; save?: boolean; title?: string } = {},
  onProgress?: (pct: number) => void,
): Promise<{ ok: boolean; analysis: ApkAnalysis; caseId?: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    if (file) form.append('apk', file);
    if (opts.sample) form.append('sample', 'true');
    if (opts.save) form.append('save', 'true');
    if (opts.title) form.append('title', opts.title);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/analyze/apk`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) resolve(data);
        else reject(new Error(data.error || `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error('Malformed response from inspector'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check the API server'));
    xhr.send(form);
  });
}
