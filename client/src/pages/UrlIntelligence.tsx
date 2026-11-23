import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Download,
  Globe2,
  Layers3,
  Loader2,
  Network,
  Radio,
  Save,
  ShieldAlert,
  Waypoints,
} from 'lucide-react';
import type { Enrichment, UrlAnalysis } from '@shared/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { shortDate } from '@/lib/format';
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

type UrlResult = UrlAnalysis & { enrichment?: Enrichment };

const SAMPLES = [
  { label: 'Typosquat + KYC path', url: 'http://sbi-secure-login.xyz/verify?acc=1' },
  { label: 'Official SBI (control)', url: 'https://www.sbi.co.in' },
  { label: 'Shortener', url: 'https://bit.ly/parcel-clear' },
  { label: 'Bare IP host', url: 'http://185.62.190.44/kyc/update' },
  { label: 'Look-alike commerce', url: 'https://amaz0n-refund.top/claim' },
];

export default function UrlIntelligence() {
  const [params] = useSearchParams();
  const initial = params.get('u') ?? '';
  const [input, setInput] = useState(initial);
  const [deepScan, setDeepScan] = useState(false);
  const [result, setResult] = useState<UrlResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);
  const { toast } = useToast();

  const analyse = async (value: string) => {
    const target = value.trim();
    if (!target) return;
    const ticket = ++seq.current;
    setLoading(true);
    setError('');
    setCaseId(null);
    try {
      const res = await api.analyzeUrl(target, { deepScan });
      if (ticket !== seq.current) return;
      setResult(res.analysis as UrlResult);
    } catch (err) {
      if (ticket !== seq.current) return;
      setResult(null);
      setError(err instanceof Error ? err.message : 'Could not analyse the URL');
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (initial) analyse(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enrichment = result?.enrichment;
  const triggered = useMemo(() => (result ? result.heuristics.filter((h) => h.triggered) : []), [result]);
  const age = enrichment?.registration.ageDays;
  const ageLabel = typeof age === 'number' ? (age < 30 ? `${age} days — very new` : age < 180 ? `${age} days — new` : `${age} days`) : 'unknown';

  const ensureCase = async (): Promise<string | null> => {
    if (caseId) return caseId;
    if (!result) return null;
    const res = await api.createCase({
      source_type: 'url',
      raw_input: result.input,
      title: title.trim() || undefined,
    });
    setCaseId(res.caseId);
    return res.caseId;
  };

  const handleSave = async () => {
    if (!result || saving) return;
    setSaving(true);
    try {
      const id = await ensureCase();
      if (id) toast(`Case ${id} opened from URL evidence`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the case', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!result || exporting) return;
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

  return (
    <div className="space-y-7">
      <PageHeader
        label="URL intelligence"
        title="Resolve a link before anyone taps it"
        description="Structural heuristics run locally and instantly. RDAP, DNS, TLS and redirect lookups each get a four-second budget, then fall back to documented fixtures. The badge always says which happened."
        actions={
          <span className="flex items-center gap-1.5 rounded-md border border-line bg-bg-1 px-2.5 py-1.5">
            <Radio size={11} className={loading ? 'animate-pulse text-accent' : 'text-ink-3'} />
            <span className="mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">
              {loading ? 'resolving' : enrichment ? `${enrichment.mode} enrichment` : 'idle'}
            </span>
          </span>
        }
      />

      <Card className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            analyse(input);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <div className="relative flex-1">
            <Globe2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setCaseId(null);
              }}
              placeholder="https://example.com/login or example.com"
              className="input h-10 pl-9 text-[13px]"
              aria-label="URL to analyse"
              spellCheck={false}
            />
          </div>
          <Button variant="primary" type="submit" className="h-10 px-5" disabled={loading || !input.trim()}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
            {loading ? 'Resolving…' : 'Analyse URL'}
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mono mr-1 text-[8.5px] uppercase tracking-[0.12em] text-ink-3">samples</span>
          {SAMPLES.map((sample) => (
            <button
              key={sample.url}
              onClick={() => {
                setInput(sample.url);
                analyse(sample.url);
              }}
              className="rounded border border-line bg-bg-1 px-2 py-1 text-[10.5px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink-2"
            >
              {sample.label}
            </button>
          ))}
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-ink-3">
          <input
            type="checkbox"
            checked={deepScan}
            onChange={(e) => setDeepScan(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          Deep scan: fetch the final page and inspect its HTML (SSRF-guarded, no JavaScript)
        </label>
      </Card>

      {error && (
        <div className="rounded-lg border border-danger/25 bg-danger/[0.06] px-4 py-3 text-[12px] text-danger/90">{error}</div>
      )}

      {!result && !loading && (
        <EmptyState
          icon={<Globe2 size={22} />}
          title="No URL resolved yet"
          description="Paste a link or choose a sample. The engine separates protocol, subdomain, registrable domain, TLD, path and query before scoring each structural signal."
        />
      )}

      {loading && !result && (
        <Card className="p-8">
          <div className="flex items-center gap-3 text-[12.5px] text-ink-2">
            <Loader2 size={15} className="animate-spin text-accent" />
            Resolving RDAP, DNS, TLS and redirects — each source is capped at 4 seconds.
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {['RDAP registration', 'DNS records', 'TLS certificate', 'Redirect chain'].map((item) => (
              <div key={item} className="rounded-md border border-line bg-bg-1 px-3 py-3">
                <div className="mono text-[9px] uppercase tracking-[0.1em] text-ink-3">{item}</div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded bg-[var(--fill-5)]">
                  <div className="h-full w-1/3 animate-pulse rounded bg-accent/50" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {result && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2 border-b border-line pb-4">
                <VerdictPill verdict={result.verdict.verdict} confidence={result.verdict.confidence} />
                <span className="mono text-[10px] text-ink-3">{result.verdict.score}/100</span>
                {result.verdict.categories.map((cat) => (
                  <span
                    key={cat}
                    className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.1em] text-ink-3"
                  >
                    {cat}
                  </span>
                ))}
              </div>
              {result.verdict.verdict === 'NO_INDICATORS' && result.verdict.disclaimer && (
                <p className="mt-3 rounded-md border border-line bg-bg-1 px-3 py-2 text-[11px] leading-relaxed text-ink-3">
                  {result.verdict.disclaimer}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Label>Structural score</Label>
                    {enrichment && (
                      <span
                        className={cn(
                          'mono rounded border px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.1em]',
                          enrichment.dataStatus === 'live'
                            ? 'border-ok/30 bg-ok/[0.07] text-ok'
                            : enrichment.dataStatus === 'fixture'
                              ? 'border-warn/30 bg-warn/[0.07] text-warn'
                              : 'border-line bg-bg-1 text-ink-3',
                        )}
                        data-testid="data-status-badge"
                      >
                        {enrichment.dataStatus === 'live'
                          ? 'live data'
                          : enrichment.dataStatus === 'fixture'
                            ? 'demo fixture'
                            : 'no network data'}
                      </span>
                    )}
                  </div>
                  <div className="mono mt-2 max-w-[62ch] break-all text-[13px] leading-relaxed text-ink-2">
                    {result.normalized}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <CopyButton value={result.normalized} label="Copy URL" />
                    <span className="text-ink-3/40">·</span>
                    <span className="mono text-[10px] text-ink-3">{result.registrableDomain}</span>
                    {result.brandMatch && (
                      <span className="rounded border border-warn/30 bg-warn/[0.07] px-1.5 py-0.5 text-[9.5px] text-warn">
                        imitates {result.brandMatch}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-end gap-3">
                  <ScoreBlock score={result.score} label={result.riskLabel} />
                  <RiskPill label={result.riskLabel} />
                </div>
              </div>
              <div className="mt-5">
                <ScoreBar score={result.score} segments={32} height={7} />
              </div>
              <div className="mono mt-2 flex justify-between text-[9px] text-ink-3">
                <span>0 · no structural signal</span>
                <span>{triggered.length} checks fired</span>
                <span>100 · capped</span>
              </div>
            </Card>

            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div>
                  <Label>URL breakdown</Label>
                  <div className="mt-0.5 text-[12px] text-ink-3">The exact anatomy the rules operated on.</div>
                </div>
                <Layers3 size={14} className="text-ink-3" />
              </div>
              <div className="grid grid-cols-2 divide-line/70 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
                {[
                  ['Protocol', result.breakdown.protocol],
                  ['Subdomain', result.breakdown.subdomain || '—'],
                  ['Domain', result.breakdown.domain],
                  ['TLD', result.breakdown.tld ? `.${result.breakdown.tld}` : '—'],
                  ['Port', result.breakdown.port || 'default'],
                  ['Path', result.breakdown.path || '/'],
                ].map(([label, value], i) => (
                  <div key={label} className={cn('px-4 py-3', i < 3 && 'border-b border-line/70 lg:border-b-0')}>
                    <div className="label">{label}</div>
                    <div
                      className={cn(
                        'mono mt-1 break-all text-[11px]',
                        label === 'Domain' ? 'text-accent' : label === 'Protocol' && value === 'http' ? 'text-danger' : 'text-ink-2',
                      )}
                    >
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              {result.breakdown.query && (
                <div className="border-t border-line px-5 py-2.5">
                  <span className="mono text-[9px] uppercase tracking-[0.1em] text-ink-3">query</span>
                  <span className="mono ml-2 break-all text-[10.5px] text-ink-2">{result.breakdown.query}</span>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-center justify-between">
                <Label>Heuristic ledger</Label>
                <span className="mono text-[9px] text-ink-3">STRUCTURE · INTENT · INFRASTRUCTURE</span>
              </div>
              <div className="mt-3">
                <RuleTable rules={result.heuristics} />
              </div>
            </Card>

            {enrichment && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <Label>Registration</Label>
                      <Clock3 size={13} className="text-ink-3" />
                    </div>
                    <div className="mt-3 space-y-2.5">
                      <Row label="Registrar" value={enrichment.registration.registrar} />
                      <Row label="Created" value={enrichment.registration.createdAt ? shortDate(enrichment.registration.createdAt) : 'unknown'} />
                      <Row
                        label="Age"
                        value={ageLabel}
                        tone={typeof age === 'number' && age < 30 ? 'danger' : undefined}
                      />
                      <Row label="Nameservers" value={enrichment.registration.nameservers.slice(0, 3).join(', ') || '—'} mono />
                      <Row label="Status" value={enrichment.registration.status.slice(0, 2).join(', ') || '—'} mono />
                    </div>
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-center justify-between">
                      <Label>DNS</Label>
                      <Network size={13} className="text-ink-3" />
                    </div>
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="label">A records</div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {enrichment.dns.a.map((ip) => (
                            <EntityChip key={ip} type="ip" value={ip} />
                          ))}
                          {!enrichment.dns.a.length && <span className="text-[11.5px] text-ink-3">No A record resolved.</span>}
                        </div>
                      </div>
                      <div>
                        <div className="label">MX</div>
                        <div className="mono mt-1 break-all text-[10.5px] text-ink-2">
                          {enrichment.dns.mx.slice(0, 3).join(' · ') || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="label">NS</div>
                        <div className="mono mt-1 break-all text-[10.5px] text-ink-2">
                          {enrichment.dns.ns.slice(0, 3).join(' · ') || '—'}
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>

                <Card className="p-5">
                  <div className="flex items-center justify-between">
                    <Label>TLS certificate</Label>
                    <ShieldAlert size={13} className="text-ink-3" />
                  </div>
                  <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Row label="Issuer" value={enrichment.tls.issuer} />
                    <Row label="Subject" value={enrichment.tls.subject} mono />
                    <Row label="Valid from" value={enrichment.tls.validFrom ? shortDate(enrichment.tls.validFrom) : '—'} />
                    <Row label="Valid to" value={enrichment.tls.validTo ? shortDate(enrichment.tls.validTo) : '—'} />
                  </div>
                  <p className="mt-3 border-t border-line pt-3 text-[10.5px] leading-relaxed text-ink-3">
                    A valid certificate only proves transport encryption. It says nothing about who owns the domain or
                    whether the page is honest.
                  </p>
                </Card>

                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-line px-5 py-3">
                    <div>
                      <Label>Redirect chain</Label>
                      <div className="mt-0.5 text-[12px] text-ink-3">Where the link actually goes, hop by hop.</div>
                    </div>
                    <Waypoints size={14} className="text-ink-3" />
                  </div>
                  <div className="divide-y divide-line/70">
                    {enrichment.redirects.map((hop, i) => (
                      <div key={`${hop.url}-${i}`} className="flex items-start gap-3 px-5 py-2.5">
                        <span
                          className={cn(
                            'mono mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[9.5px]',
                            hop.status >= 300 && hop.status < 400
                              ? 'border-warn/30 bg-warn/[0.07] text-warn'
                              : hop.status >= 200 && hop.status < 300
                                ? 'border-ok/25 bg-ok/[0.06] text-ok'
                                : 'border-line text-ink-3',
                          )}
                        >
                          {hop.status}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="mono break-all text-[10.5px] text-ink-2">{hop.url}</div>
                          {hop.location && (
                            <div className="mono mt-0.5 flex items-center gap-1 break-all text-[9.5px] text-ink-3">
                              <ArrowUpRight size={9} /> {hop.location}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {!enrichment.redirects.length && (
                      <div className="px-5 py-4 text-[11.5px] text-ink-3">No redirect hops recorded.</div>
                    )}
                  </div>
                </Card>
              </>
            )}

            {enrichment?.note && (
              <div className="flex items-start gap-2 rounded-lg border border-line bg-bg-1 px-4 py-3 text-[11px] leading-relaxed text-ink-3">
                <Radio size={12} className="mt-0.5 shrink-0 text-ink-3" />
                <span>{enrichment.note}</span>
              </div>
            )}
          </div>

          <div className="space-y-4 lg:sticky lg:top-20">
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <Label>Case file</Label>
                <Globe2 size={13} className="text-ink-3" />
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
                  Saving stores the URL, domain, resolved IPs and every heuristic as evidence.
                </p>
              )}
              <div className="mt-3">
                <Label>Case title</Label>
                <input
                  className="input mt-1.5 text-[12px]"
                  placeholder="Optional — generated from the domain"
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
            </Card>

            <Card className="p-4">
              <Label>Reading the result</Label>
              <div className="mt-3 space-y-3">
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
                  <div>
                    <div className="text-[11.5px] text-ink-2">High · 60–100</div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">
                      Multiple independent identity or infrastructure signals agree. Treat as hostile until disproven.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                  <div>
                    <div className="text-[11.5px] text-ink-2">Medium · 30–59</div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">
                      One strong signal or several weak ones. Verify ownership through an official channel.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" />
                  <div>
                    <div className="text-[11.5px] text-ink-2">Low · 0–29</div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">
                      No structural rule fired. This is not a certification of safety.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4" data-testid="coverage-panel">
              <div className="flex items-center justify-between">
                <Label>What we could not check</Label>
                <span className="mono text-[9px] text-ink-3">{result.verdict.coverage.checksRun.length} RAN</span>
              </div>
              <ul className="mt-3 space-y-2">
                {result.verdict.coverage.checksSkipped.map((skip) => (
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
              <Label>Signals at a glance</Label>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Mini label="Checks" value={`${triggered.length}/${result.heuristics.length}`} />
                <Mini label="HTTP" value={result.breakdown.protocol === 'http' ? 'insecure' : 'TLS'} tone={result.breakdown.protocol === 'http' ? 'danger' : 'ok'} />
                <Mini label="Shortener" value={result.isShortener ? 'yes' : 'no'} tone={result.isShortener ? 'danger' : undefined} />
                <Mini label="Bare IP" value={result.isIp ? 'yes' : 'no'} tone={result.isIp ? 'danger' : undefined} />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: 'danger' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[10.5px] text-ink-3">{label}</span>
      <span
        className={cn(
          'min-w-0 break-all text-right text-[11px]',
          mono && 'mono',
          tone === 'danger' ? 'text-danger' : 'text-ink-2',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'ok' }) {
  return (
    <div className="rounded-md border border-line bg-bg-1 px-2.5 py-2">
      <div className="label">{label}</div>
      <div
        className={cn(
          'mono mt-1 text-[11px]',
          tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink-2',
        )}
      >
        {value}
      </div>
    </div>
  );
}
