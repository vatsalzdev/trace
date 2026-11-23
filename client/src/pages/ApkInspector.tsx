import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  FileArchive,
  Fingerprint,
  FolderSearch,
  Loader2,
  PackageSearch,
  Save,
  ShieldAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import type { ApkAnalysis } from '@shared/types';
import { analyzeApkFile, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { downloadReportPdf } from '@/lib/pdf';
import { useToast } from '@/components/Toast';
import { EntityChip } from '@/components/EntityChip';
import {
  Button,
  Card,
  CopyButton,
  EmptyState,
  Label,
  PageHeader,
  RiskPill,
  RuleTable,
  ScoreBar,
  ScoreBlock,
  VerdictPill,
} from '@/components/ui';

const APK_MAX_BYTES = 20 * 1024 * 1024;

const COMPONENT_LABEL: Record<string, string> = {
  activity: 'Activity',
  service: 'Service',
  receiver: 'Receiver',
  provider: 'Provider',
};

type ApkTab = 'overview' | 'permissions' | 'components' | 'indicators' | 'hashes';

const APK_TABS: { id: ApkTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'components', label: 'Components' },
  { id: 'indicators', label: 'Indicators' },
  { id: 'hashes', label: 'Hashes' },
];

export default function ApkInspector() {
  const [analysis, setAnalysis] = useState<ApkAnalysis | null>(null);
  const [tab, setTab] = useState<ApkTab>('overview');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const run = async (file: File | null, sample = false) => {
    if (!file && !sample) return;
    setError('');
    if (file && file.size > APK_MAX_BYTES) {
      setError('APK must be 20 MB or smaller.');
      return;
    }
    if (file && !/\.apk$/i.test(file.name) && file.type !== 'application/vnd.android.package-archive') {
      setError('Choose a .apk file.');
      return;
    }
    setLoading(true);
    setProgress(sample ? 18 : 2);
    setCaseId(null);
    setAnalysis(null);
    setTab('overview');
    setFileName(file?.name ?? 'trace-sample-banking-trojan.apk');
    setFileSize(file?.size ?? 0);
    try {
      const res = await analyzeApkFile(file, { sample }, (pct) => setProgress(Math.max(8, pct)));
      setProgress(100);
      setAnalysis(res.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not inspect the package');
    } finally {
      setLoading(false);
    }
  };

  const ensureCase = async (): Promise<string | null> => {
    if (caseId) return caseId;
    if (!analysis) return null;
    const res = await api.createCase({
      source_type: 'apk',
      raw_input: analysis.fileName,
      sha256: analysis.sha256,
      title: title.trim() || undefined,
    });
    setCaseId(res.caseId);
    return res.caseId;
  };

  const handleSave = async () => {
    if (!analysis || saving) return;
    setSaving(true);
    try {
      const id = await ensureCase();
      if (id) toast(`Case ${id} opened from the APK inspection`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the case', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!analysis || exporting) return;
    setExporting(true);
    try {
      const id = await ensureCase();
      if (!id) return;
      const res = await api.reportData(id);
      downloadReportPdf(res.report);
      toast(`Report ${res.report.reportId} generated`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not generate the report', 'error');
    } finally {
      setExporting(false);
    }
  };

  const dangerous = analysis ? analysis.permissions.filter((p) => p.dangerous) : [];
  const exported = analysis ? analysis.components.filter((c) => c.exported) : [];

  return (
    <div className="space-y-7">
      <PageHeader
        label="APK inspector"
        title="Unpack the package before it unpacks the victim"
        description="The manifest is decoded from binary AXML, permissions are weighted, components are enumerated and embedded infrastructure is extracted. Nothing is executed."
        actions={
          <a href="/api/sample-apk" className="btn btn-ghost h-8 text-[11.5px]" download>
            <Download size={12} /> Download sample APK
          </a>
        }
      />

      <Card className="p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) run(file);
          }}
          className={cn(
            'relative flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors',
            dragging ? 'border-accent/60 bg-accent/[0.05]' : 'border-line-2 bg-bg-1/40 hover:border-line-2',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) run(file);
              e.currentTarget.value = '';
            }}
          />
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-bg-2">
            {loading ? <Loader2 size={19} className="animate-spin text-accent" /> : <UploadCloud size={19} className="text-ink-3" />}
          </div>
          <div className="mt-4 text-[14px] font-medium text-ink">
            {loading ? 'Inspecting package…' : 'Drop an APK here, or choose a file'}
          </div>
          <p className="mt-1.5 max-w-[56ch] text-[12px] leading-relaxed text-ink-3">
            Maximum 20 MB. The package is parsed in memory, never installed. Binary Android manifests are decoded; a plain
            XML manifest is also accepted.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={loading}>
              <FolderSearch size={13} /> Choose APK
            </Button>
            <Button onClick={() => run(null, true)} disabled={loading}>
              <PackageSearch size={13} /> Load sample APK
            </Button>
          </div>
          {(loading || progress > 0) && (
            <div className="mt-6 w-full max-w-[360px]">
              <div className="flex items-center justify-between">
                <span className="mono truncate text-[9.5px] uppercase tracking-[0.1em] text-ink-3">
                  {fileName || 'reading package'}
                </span>
                <span className="mono text-[9.5px] text-ink-3">{progress}%</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-[var(--fill-5)]">
                <div
                  className="h-full rounded bg-accent transition-[width] duration-300 ease-expo"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
          {fileSize > 0 && !loading && (
            <div className="mono mt-3 flex items-center gap-2 text-[9.5px] text-ink-3">
              <FileArchive size={10} /> {formatBytes(fileSize)} · upload complete
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] text-ink-3">
          <span className="flex items-center gap-1.5"><Fingerprint size={10} /> SHA-256 and MD5 retained</span>
          <span className="flex items-center gap-1.5"><ShieldAlert size={10} /> dangerous permissions weighted</span>
          <span className="flex items-center gap-1.5"><PackageSearch size={10} /> manifest decoded from AXML</span>
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger/[0.06] px-4 py-3 text-[12px] text-danger/90">{error}</div>
      )}

      {!analysis && !loading && (
        <EmptyState
          icon={<PackageSearch size={22} />}
          title="No package inspected"
          description="Use the sample trojan to see the full pipeline, or drop a real APK. The inspector never executes code and never uploads to a third party."
        />
      )}

      {analysis && (
        <>
          <div className="flex flex-wrap gap-1 border-b border-line">
            {APK_TABS.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  'relative px-3 py-2 text-[11.5px] transition-colors',
                  tab === item.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                {item.label}
                {tab === item.id && <span className="absolute inset-x-2 -bottom-px h-px bg-accent" />}
              </button>
            ))}
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              <Card className="p-5" data-testid="apk-verdict-banner">
                <div className="flex flex-wrap items-center gap-2">
                  <VerdictPill verdict={analysis.verdict.verdict} confidence={analysis.verdict.confidence} />
                  <span className="mono text-[10px] text-ink-3">{analysis.verdict.score}/100</span>
                  {analysis.verdict.categories.map((cat) => (
                    <span
                      key={cat}
                      className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.1em] text-ink-3"
                    >
                      {cat}
                    </span>
                  ))}
                  {analysis.packed && (
                    <span className="mono rounded border border-warn/30 bg-warn/[0.07] px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.1em] text-warn">
                      packed
                    </span>
                  )}
                </div>
                {analysis.verdict.verdict === 'NO_INDICATORS' && analysis.verdict.disclaimer && (
                  <p className="mt-3 text-[11px] leading-relaxed text-ink-3">{analysis.verdict.disclaimer}</p>
                )}
              </Card>

              {tab === 'overview' && (
            <>
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Label>Package score</Label>
                    <span className="mono rounded border border-line px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.1em] text-ink-3">
                      manifest {analysis.manifestFormat}
                    </span>
                  </div>
                  <div className="mt-2 text-[18px] font-medium tracking-[-0.02em] text-ink">{analysis.appLabel || analysis.packageName}</div>
                  <div className="mono mt-1 break-all text-[11.5px] text-ink-2">{analysis.packageName}</div>
                  <div className="mono mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[9.5px] text-ink-3">
                    <span>v{analysis.versionName} ({analysis.versionCode})</span>
                    <span>minSdk {analysis.minSdk}</span>
                    <span>targetSdk {analysis.targetSdk}</span>
                    <span>{analysis.fileName}</span>
                    <span>{formatBytes(analysis.fileSize)}</span>
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <ScoreBlock score={analysis.score} label={analysis.riskLabel} />
                  <RiskPill label={analysis.riskLabel} />
                </div>
              </div>
              <div className="mt-5">
                <ScoreBar score={analysis.score} segments={32} height={7} />
              </div>
              <div className="mono mt-2 flex justify-between text-[9px] text-ink-3">
                <span>{dangerous.length} dangerous permissions · {exported.length} exported components</span>
                <span>{analysis.rules.filter((r) => r.triggered).length} rules fired</span>
              </div>
              <p className="mt-4 border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-2">{analysis.summary}</p>
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <Label>Capability matrix</Label>
                <span className="mono text-[9px] text-ink-3">STATIC REFERENCES ONLY</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {analysis.capabilities.map((cap) => (
                  <div key={cap.id} className="rounded-md border border-line bg-bg-1 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11.5px] text-ink-2">{cap.label}</span>
                      <span className={cn('mono text-[9px] uppercase tracking-[0.08em]', cap.triggered ? 'text-danger' : 'text-ink-3')}>
                        {cap.triggered ? 'present' : 'none'}
                      </span>
                    </div>
                    {cap.evidence.length > 0 && (
                      <div className="mono mt-1 break-all text-[9.5px] leading-relaxed text-ink-3">{cap.evidence.join(' · ')}</div>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <Label>DEX files and nested payloads</Label>
                  <div className="mt-0.5 text-[12px] text-ink-3">Every classes*.dex was parsed; assets and raw resources were inventoried.</div>
                </div>
                <FolderSearch size={14} className="text-ink-3" />
              </div>
              <div className="divide-y divide-line/70">
                {analysis.dexFiles.map((dex) => (
                  <div key={dex.name} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="mono break-all text-[10.5px] text-ink-2">{dex.name}</span>
                    <span className="mono text-[9.5px] text-ink-3">
                      {formatBytes(dex.size)} · {dex.strings} strings · {dex.methods} methods{dex.truncated ? ' · truncated' : ''}
                    </span>
                  </div>
                ))}
                {analysis.nestedFiles.map((file) => (
                  <div key={file.name} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="mono break-all text-[10.5px] text-ink-2">{file.name}</span>
                    <span className={cn('mono text-[9.5px]', file.kind === 'apk' || file.kind === 'dex' ? 'text-danger' : 'text-ink-3')}>
                      {file.kind.toUpperCase()} · {formatBytes(file.size)}
                    </span>
                  </div>
                ))}
                {!analysis.dexFiles.length && !analysis.nestedFiles.length && (
                  <div className="px-5 py-4 text-[11.5px] text-ink-3">No DEX files or nested payloads recorded.</div>
                )}
              </div>
            </Card>
            </>
              )}

              {tab === 'hashes' && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <Label>Hashes</Label>
                <Fingerprint size={13} className="text-ink-3" />
              </div>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="label">SHA-256</div>
                  <div className="mt-1 flex items-start gap-2">
                    <span className="mono break-all text-[10.5px] leading-relaxed text-ink-2">{analysis.sha256}</span>
                    <CopyButton value={analysis.sha256} label="" />
                  </div>
                </div>
                <div>
                  <div className="label">MD5</div>
                  <div className="mono mt-1 break-all text-[10.5px] text-ink-2">{analysis.md5}</div>
                </div>
              </div>
            </Card>
              )}

              {tab === 'permissions' && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <Label>Permissions ({analysis.permissions.length})</Label>
                  <div className="mt-0.5 text-[12px] text-ink-3">Dangerous capabilities are weighted individually.</div>
                </div>
                <span className="mono text-[9px] text-danger">{dangerous.length} DANGEROUS</span>
              </div>
              <div className="divide-y divide-line/70">
                {analysis.permissions.map((permission) => (
                  <div key={permission.name} className="flex items-start gap-3 px-5 py-2.5" data-testid="permission-row">
                    <span
                      className={cn(
                        'mono mt-0.5 w-[112px] shrink-0 truncate text-[9.5px] uppercase tracking-[0.06em]',
                        permission.dangerous ? 'text-danger' : 'text-ink-3',
                      )}
                      title={permission.name}
                    >
                      {permission.short}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mono break-all text-[10px] text-ink-2">{permission.name}</div>
                      <div className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{permission.reason}</div>
                    </div>
                    <span
                      className={cn(
                        'mono shrink-0 rounded border px-1.5 py-0.5 text-[9.5px]',
                        permission.dangerous ? 'border-danger/25 bg-danger/[0.06] text-danger' : 'border-line text-ink-3',
                      )}
                    >
                      +{permission.weight}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
              )}

              {tab === 'components' && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <Label>Components ({analysis.components.length})</Label>
                  <div className="mt-0.5 text-[12px] text-ink-3">Exported components are reachable by other apps.</div>
                </div>
                <span className="mono text-[9px] text-ink-3">{exported.length} EXPORTED</span>
              </div>
              <div className="divide-y divide-line/70">
                {analysis.components.map((component) => (
                  <div key={`${component.type}-${component.name}`} className="flex items-start gap-3 px-5 py-2.5">
                    <span className="mono mt-0.5 w-[62px] shrink-0 text-[9px] uppercase tracking-[0.08em] text-ink-3">
                      {COMPONENT_LABEL[component.type]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mono break-all text-[10.5px] text-ink-2">{component.name}</div>
                      {component.intentFilters.length > 0 && (
                        <div className="mono mt-1 flex flex-wrap gap-1">
                          {component.intentFilters.map((filter, i) => (
                            <span key={`${filter}-${i}`} className="rounded border border-line px-1.5 py-0.5 text-[8.5px] text-ink-3">
                              {filter}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span
                      className={cn(
                        'mono shrink-0 rounded border px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.08em]',
                        component.exported ? 'border-warn/30 bg-warn/[0.07] text-warn' : 'border-line text-ink-3',
                      )}
                    >
                      {component.exported ? 'exported' : 'internal'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
              )}

              {tab === 'indicators' && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Embedded indicators ({analysis.indicators.length})</Label>
                  <div className="mt-0.5 text-[12px] text-ink-3">URLs, domains, IPs, UPI IDs and wallets found in the package.</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {analysis.indicators.map((indicator, i) => (
                  <EntityChip
                    key={`${indicator.type}-${indicator.normalized}-${i}`}
                    type={indicator.type}
                    value={indicator.normalized}
                    note={indicator.source}
                  />
                ))}
                {!analysis.indicators.length && <div className="text-[12px] text-ink-3">No embedded indicators extracted.</div>}
              </div>
            </Card>
              )}

              {tab === 'overview' && (
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <Label>Rule ledger</Label>
                <span className="mono text-[9px] text-ink-3">PERMISSIONS · COMPONENTS · NETWORK</span>
              </div>
              <div className="mt-3">
                <RuleTable rules={analysis.rules} />
              </div>
            </Card>
              )}
            </div>

          <div className="space-y-4 lg:sticky lg:top-20">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <Label>Case file</Label>
                <PackageSearch size={13} className="text-ink-3" />
              </div>
              {caseId ? (
                <div className="mt-3 rounded-lg border border-ok/25 bg-ok/[0.06] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[11.5px] text-ok">
                    <CheckCircle2 size={13} /> Case opened
                  </div>
                  <Link to={`/app/cases/${caseId}`} className="mono mt-1 flex items-center gap-1 text-[11px] text-ink-2 hover:text-ink">
                    {caseId} <ArrowUpRight size={11} />
                  </Link>
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                  The package hash and every embedded indicator are stored with the case.
                </p>
              )}
              <div className="mt-3">
                <Label>Case title</Label>
                <input
                  className="input mt-1.5 text-[12px]"
                  placeholder="Optional — generated from the package"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={Boolean(caseId)}
                />
              </div>
              <div className="mt-3 space-y-2">
                {!caseId ? (
                  <Button variant="primary" className="w-full" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {saving ? 'Opening case…' : 'Save as case'}
                  </Button>
                ) : (
                  <Link to={`/app/cases/${caseId}`} className="btn btn-primary w-full">
                    Open case file <ArrowUpRight size={13} />
                  </Link>
                )}
                <Button className="w-full" onClick={handleExport} disabled={exporting}>
                  {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {exporting ? 'Building PDF…' : 'Export report PDF'}
                </Button>
              </div>
              <button
                onClick={() => {
                  setAnalysis(null);
                  setProgress(0);
                  setCaseId(null);
                  setError('');
                }}
                className="mt-3 flex w-full items-center justify-center gap-1.5 border-t border-line pt-3 text-[10.5px] text-ink-3 transition-colors hover:text-ink"
              >
                <X size={11} /> Clear inspection
              </button>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <Label>Certificate</Label>
                <ShieldAlert size={13} className="text-ink-3" />
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-3">Signature block</span>
                  <span className={analysis.certificate.present ? 'text-ok' : 'text-warn'}>
                    {analysis.certificate.present ? 'present' : 'absent'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ink-3">Debug signed</span>
                  <span className={analysis.certificate.debugSigned ? 'text-danger' : 'text-ink-2'}>
                    {analysis.certificate.debugSigned ? 'yes' : 'no'}
                  </span>
                </div>
                {analysis.certificate.files.length > 0 && (
                  <div className="mono break-all pt-1 text-[9.5px] leading-relaxed text-ink-3">
                    {analysis.certificate.files.join(', ')}
                  </div>
                )}
                {analysis.certificate.subject && (
                  <div className="border-t border-line pt-2">
                    <div className="label">Subject</div>
                    <div className="mono mt-0.5 break-all text-[9.5px] leading-relaxed text-ink-3">{analysis.certificate.subject}</div>
                  </div>
                )}
                {analysis.certificate.issuer && (
                  <div>
                    <div className="label">Issuer</div>
                    <div className="mono mt-0.5 break-all text-[9.5px] leading-relaxed text-ink-3">{analysis.certificate.issuer}</div>
                  </div>
                )}
                {analysis.certificate.sha256Fingerprint && (
                  <div>
                    <div className="label">SHA-256 fingerprint</div>
                    <div className="mono mt-0.5 break-all text-[9px] leading-relaxed text-ink-3">{analysis.certificate.sha256Fingerprint}</div>
                  </div>
                )}
                {analysis.certificate.validTo && (
                  <div className="flex items-center justify-between text-[10.5px]">
                    <span className="text-ink-3">Valid to</span>
                    <span className={analysis.certificate.longValidity ? 'text-warn' : 'text-ink-2'}>
                      {analysis.certificate.validTo.slice(0, 10)}
                      {analysis.certificate.longValidity ? ' (30y+)' : ''}
                    </span>
                  </div>
                )}
                {analysis.certificate.anomalies.length > 0 && (
                  <div className="text-[10px] leading-relaxed text-warn">{analysis.certificate.anomalies.join(' · ')}</div>
                )}
              </div>
            </Card>

            <Card className="p-4" data-testid="coverage-panel">
              <div className="flex items-center justify-between">
                <Label>What we could not check</Label>
                <span className="mono text-[9px] text-ink-3">{analysis.verdict.coverage.checksRun.length} RAN</span>
              </div>
              <ul className="mt-3 space-y-2">
                {analysis.verdict.coverage.checksSkipped.map((skip) => (
                  <li key={skip.id} className="flex gap-2 text-[11px] leading-relaxed text-ink-3">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--fill-5)]" />
                    <span>
                      <span className="mono text-[9px] uppercase tracking-[0.1em] text-ink-2">{skip.id}</span>
                      <br />
                      {skip.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-4">
              <Label>Why this matters</Label>
              <div className="mt-2 space-y-2.5 text-[11px] leading-relaxed text-ink-3">
                <p>
                  <span className="text-ink-2">SMS access</span> lets a trojan read the OTP before the victim does.
                </p>
                <p>
                  <span className="text-ink-2">Overlay permission</span> draws a fake banking screen above the real app.
                </p>
                <p>
                  <span className="text-ink-2">Accessibility</span> grants remote control of taps and screens.
                </p>
                <p>
                  <span className="text-ink-2">Exported services</span> widen the attack surface beyond the installer.
                </p>
              </div>
              <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-ink-3">
                A low score is not a safety guarantee. The package is parsed, not sandbox-executed.
              </p>
            </Card>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
