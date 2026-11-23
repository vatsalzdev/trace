import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Download,
  FileText,
  Hash,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { relativeTime, riskClass, shortDate } from '@/lib/format';
import { downloadReportPdf } from '@/lib/pdf';
import { useToast } from '@/components/Toast';
import { Button, Card, CopyButton, EmptyState, Label, PageHeader } from '@/components/ui';

interface ReportRow {
  id: string;
  case_id: string;
  analyst: string;
  payload_hash: string;
  created_at: string;
  title: string;
  risk_label: string;
}

export default function Reports() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);
  const { toast } = useToast();

  const load = () => {
    setLoading(true);
    setError('');
    api
      .reports()
      .then((res) => setReports(res.reports))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load reports'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const download = async (id: string) => {
    if (downloading) return;
    setDownloading(id);
    try {
      const res = await api.report(id);
      downloadReportPdf(res.report);
      toast(`Downloaded ${id}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not download the report', 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        label="Reports"
        title="Evidence you can hand to a court"
        description="Each report is generated from the stored case payload, hashed with SHA-256 and rendered as a paginated PDF. Regenerating never mutates the underlying case."
        actions={
          <>
            <span className="mono hidden text-[9.5px] uppercase tracking-[0.1em] text-ink-3 sm:inline">
              {reports.length} report{reports.length === 1 ? '' : 's'}
            </span>
            <button onClick={load} className="btn h-8 text-[11.5px]">
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <Label>Report register</Label>
              <div className="mt-0.5 text-[12px] text-ink-3">Newest first. Downloading re-renders from the stored payload.</div>
            </div>
            <FileText size={14} className="text-ink-3" />
          </div>

          <div className="grid grid-cols-[132px_96px_minmax(0,1fr)_104px_64px_88px_38px] items-center gap-3 border-b border-line px-4 py-2">
            {['REPORT', 'CASE', 'TITLE', 'ANALYST', 'RISK', 'GENERATED', ''].map((h, i) => (
              <span key={`${h}-${i}`} className="mono text-[9px] uppercase tracking-[0.1em] text-ink-3">
                {h}
              </span>
            ))}
          </div>

          {loading && (
            <div>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 border-b border-line/60 px-4 py-3 last:border-0">
                  <div className="h-2.5 w-24 animate-pulse rounded bg-bg-2" />
                  <div className="h-2.5 w-16 animate-pulse rounded bg-bg-2" />
                  <div className="h-2.5 flex-1 animate-pulse rounded bg-bg-2" />
                </div>
              ))}
            </div>
          )}

          {!loading && error && <div className="px-4 py-10 text-center text-[12px] text-danger/90">{error}</div>}

          {!loading && !error && reports.length === 0 && (
            <div className="p-4">
              <EmptyState
                icon={<FileText size={20} />}
                title="No reports generated yet"
                description="Open a case and choose Generate report PDF. The report is stored in the register with its integrity hash."
                action={
                  <Link to="/app/cases" className="btn btn-primary">
                    Go to cases
                  </Link>
                }
              />
            </div>
          )}

          {!loading && !error && reports.length > 0 && (
            <div>
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="group grid grid-cols-[132px_96px_minmax(0,1fr)_104px_64px_88px_38px] items-center gap-3 border-b border-line/70 px-4 py-2.5 transition-colors last:border-0 hover:bg-[var(--fill-1)]"
                >
                  <div className="min-w-0">
                    <div className="mono truncate text-[9.5px] text-ink-2">{report.id}</div>
                    <div className="mono mt-0.5 truncate text-[8px] text-ink-3/70" title={report.payload_hash}>
                      {report.payload_hash.slice(0, 10)}…
                    </div>
                  </div>
                  <Link to={`/app/cases/${report.case_id}`} className="mono text-[9.5px] text-ink-3 transition-colors hover:text-ink">
                    {report.case_id}
                  </Link>
                  <Link to={`/app/cases/${report.case_id}`} className="min-w-0 truncate text-[11.5px] text-ink-2 transition-colors hover:text-ink">
                    {report.title}
                  </Link>
                  <span className="truncate text-[10.5px] text-ink-3">{report.analyst.replace('Analyst — ', '')}</span>
                  <span className={riskClass(report.risk_label)}>{report.risk_label}</span>
                  <div>
                    <div className="text-[10.5px] text-ink-3">{shortDate(report.created_at)}</div>
                    <div className="mono text-[8px] text-ink-3/70">{relativeTime(report.created_at)}</div>
                  </div>
                  <button
                    onClick={() => download(report.id)}
                    disabled={Boolean(downloading)}
                    className="flex h-7 w-7 items-center justify-center rounded border border-line text-ink-3 transition-colors hover:border-line-2 hover:text-ink disabled:opacity-40"
                    title="Download PDF"
                    aria-label={`Download ${report.id}`}
                  >
                    {downloading === report.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
            <span className="mono text-[9px] text-ink-3">{reports.length} STORED PAYLOADS</span>
            <span className="mono text-[9px] text-ink-3">SHA-256 INTEGRITY</span>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Integrity</Label>
              <ShieldCheck size={14} className="text-ok/80" />
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              The payload hash covers the case, analysis, rules, entities, correlations, timeline and notes. Any change to
              those inputs produces a different report ID and hash.
            </p>
            <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
              <Hash size={11} className="text-ink-3" />
              <span className="mono text-[9px] text-ink-3">SHA-256 over canonical JSON</span>
            </div>
          </Card>

          <Card className="p-4">
            <Label>What the PDF contains</Label>
            <div className="mt-3 space-y-2">
              {[
                'Cover with risk, source, analyst and report ID',
                'Executive summary and original evidence',
                'Rule ledger with weights and exact matches',
                'Extracted indicators and cross-case reuse',
                'Technical analysis, timeline and notes',
                'Methodology and payload integrity hash',
              ].map((item, i) => (
                <div key={item} className="flex items-start gap-2">
                  <span className="mono mt-0.5 w-4 shrink-0 text-[8.5px] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[11px] leading-relaxed text-ink-2">{item}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Latest payload</Label>
              <ArrowUpRight size={12} className="text-ink-3" />
            </div>
            {reports[0] ? (
              <div className="mt-2 space-y-2">
                <div className="mono break-all text-[10px] text-ink-2">{reports[0].id}</div>
                <div className="flex items-center gap-2">
                  <span className={riskClass(reports[0].risk_label)}>{reports[0].risk_label}</span>
                  <span className="mono text-[9px] text-ink-3">{relativeTime(reports[0].created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CopyButton value={reports[0].payload_hash} label="Copy hash" />
                  <span className="text-ink-3/40">·</span>
                  <Link to={`/app/cases/${reports[0].case_id}`} className="text-[10px] text-ink-3 transition-colors hover:text-ink">
                    Open case
                  </Link>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">Generate a report from any case to populate the register.</p>
            )}
          </Card>

          <Card className={cn('p-4', 'border-accent/20 bg-accent/[0.035]')}>
            <Label>Honest output</Label>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              The PDF never claims certainty. It records what fired, the exact evidence, the weights and the resulting sum.
              A negative result is stated as a negative result, not a guarantee of safety.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
