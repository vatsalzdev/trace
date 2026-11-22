import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Braces,
  CheckCircle2,
  Download,
  FileText,
  Link2,
  Loader2,
  MessageSquareText,
  Save,
  ScanLine,
  Trash2,
} from 'lucide-react';
import { SAMPLE_MESSAGES, analyzeMessage } from '@shared/message';
import type { MessageAnalysis } from '@shared/types';
import { api } from '@/lib/api';
import { riskClass } from '@/lib/format';
import { useDebounce } from '@/lib/hooks';
import { downloadReportPdf } from '@/lib/pdf';
import { cn } from '@/lib/cn';
import { EntityChip } from '@/components/EntityChip';
import { HighlightedText } from '@/components/HighlightedText';
import { useToast } from '@/components/Toast';
import {
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  RiskPill,
  RuleTable,
  ScoreBar,
  ScoreBlock,
} from '@/components/ui';

const CATEGORY_LABEL: Record<string, string> = {
  coercion: 'Coercion',
  identity: 'Identity',
  transport: 'Transport',
  financial: 'Financial',
  credential: 'Credential',
  pretext: 'Pretext',
  malware: 'Malware',
};

export default function MessageScanner() {
  const [text, setText] = useState('');
  const debounced = useDebounce(text, 150);
  const [analysis, setAnalysis] = useState<MessageAnalysis | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const value = debounced.trim();
    if (!value) {
      setAnalysis(null);
      return;
    }
    setAnalysis(analyzeMessage(debounced));
  }, [debounced]);

  const active = analysis && analysis.input === text ? analysis : null;
  const fresh = Boolean(active);
  const triggered = useMemo(() => (active ? active.rules.filter((r) => r.triggered) : []), [active]);
  const urlCount = active ? active.urls.length : 0;
  const entityCount = active ? active.entities.length : 0;

  const changeText = (value: string) => {
    setText(value);
    setCaseId(null);
    if (!value.trim()) setAnalysis(null);
  };

  const useSample = (value: string) => {
    setCaseId(null);
    setTitle('');
    setText(value);
  };

  const ensureCase = async (): Promise<string | null> => {
    if (caseId) return caseId;
    if (!text.trim()) return null;
    const res = await api.analyzeMessage(text, { save: true, title: title.trim() || undefined });
    const id = res.caseId ?? null;
    setCaseId(id);
    return id;
  };

  const handleSave = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      const id = await ensureCase();
      if (id) toast(`Case ${id} opened with ${entityCount} indicators`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the case', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!text.trim() || exporting) return;
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
        label="Message scanner"
        title="Read the message the way an attacker wrote it"
        description="Paste an SMS, WhatsApp or email body. Every score below is the sum of documented rule weights — no model, no probability, no hidden judgement."
        actions={
          <>
            <span className="mono hidden text-[9.5px] uppercase tracking-[0.12em] text-ink-3 sm:inline">
              {text.length.toLocaleString()} chars
            </span>
            <span className="flex items-center gap-1.5 rounded-md border border-line bg-bg-1 px-2.5 py-1.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', fresh ? 'bg-ok' : 'bg-ink-3/50')} />
              <span className="mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">
                {fresh ? 'live result' : 'idle'}
              </span>
            </span>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-2">
                <MessageSquareText size={13} className="text-ink-3" />
                <span className="text-[11.5px] text-ink-2">Evidence composer</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => useSample(SAMPLE_MESSAGES[0].text)}
                  className="mono text-[9px] uppercase tracking-[0.1em] text-ink-3 transition-colors hover:text-ink"
                >
                  load sample
                </button>
                {text && (
                  <button
                    onClick={() => changeText('')}
                    className="flex items-center gap-1 text-[10.5px] text-ink-3 transition-colors hover:text-ink"
                  >
                    <Trash2 size={11} /> Clear
                  </button>
                )}
              </div>
            </div>

            <div className="relative">
              <div
                ref={overlayRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden border border-transparent px-4 py-3 text-[13px] leading-[1.75] text-ink-2"
              >
                <div className="whitespace-pre-wrap break-words">
                  {active ? (
                    <HighlightedText text={text} entities={active.entities} />
                  ) : text ? (
                    text
                  ) : (
                    <span className="text-ink-3">
                      Paste the full message here — include the sender line, link and any payment identifier. Nothing is
                      rewritten.
                    </span>
                  )}
                </div>
              </div>
              <textarea
                value={text}
                onChange={(e) => changeText(e.target.value)}
                onScroll={(e) => {
                  if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (text.trim()) setAnalysis(analyzeMessage(text));
                  }
                }}
                spellCheck={false}
                className="relative block h-[248px] w-full resize-none border-0 bg-transparent px-4 py-3 text-[13px] leading-[1.75] text-transparent outline-none"
                style={{ caretColor: 'var(--text)' }}
                placeholder=""
                aria-label="Message evidence"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="mono text-[9px] uppercase tracking-[0.1em] text-ink-3">
                  {active ? `${triggered.length} of ${active.rules.length} checks fired` : 'waiting for input'}
                </span>
                {fresh && (
                  <span className="mono text-[9px] text-ink-3/70">
                    {entityCount} indicators · {urlCount} links
                  </span>
                )}
              </div>
              <span className="mono text-[9px] text-ink-3/70">⌘/Ctrl + ↵ to run now</span>
            </div>
          </Card>

          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_MESSAGES.map((sample) => (
              <button
                key={sample.id}
                onClick={() => useSample(sample.text)}
                className={cn(
                  'group flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors',
                  text === sample.text
                    ? 'border-accent/40 bg-accent/[0.08] text-ink'
                    : 'border-line bg-bg-1 text-ink-3 hover:border-line-2 hover:text-ink-2',
                )}
              >
                <span className="mono text-[8.5px] uppercase tracking-[0.1em] text-ink-3">{sample.channel}</span>
                <span>{sample.label}</span>
              </button>
            ))}
          </div>

          {!text.trim() && (
            <EmptyState
              icon={<ScanLine size={22} />}
              title="No evidence loaded"
              description="Paste a message or pick a sample above. The scanner extracts indicators, scores every rule and keeps the exact matched evidence."
            />
          )}

          {active && (
            <>
              {active.urls.length > 0 && (
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-line px-5 py-3">
                    <div>
                      <Label>Linked destinations</Label>
                      <div className="mt-0.5 text-[12px] text-ink-3">Each link is independently scored by the URL engine.</div>
                    </div>
                    <Link2 size={14} className="text-ink-3" />
                  </div>
                  <div className="divide-y divide-line/70">
                    {active.urls.map((u) => (
                      <button
                        key={`${u.span.start}-${u.span.value}`}
                        onClick={() => navigate(`/app/url?u=${encodeURIComponent(u.span.value)}`)}
                        className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--fill-1)]"
                      >
                        <span className={riskClass(u.analysis.riskLabel)}>{u.analysis.riskLabel}</span>
                        <div className="min-w-0 flex-1">
                          <div className="mono truncate text-[11.5px] text-ink-2 group-hover:text-ink">{u.span.value}</div>
                          <div className="mt-0.5 text-[10px] text-ink-3">
                            {u.analysis.registrableDomain}
                            {u.analysis.brandMatch ? ` · imitates ${u.analysis.brandMatch}` : ''}
                          </div>
                        </div>
                        <span className="mono text-[11px] text-ink-3">{u.analysis.score}</span>
                        <ArrowUpRight size={12} className="text-ink-3 transition-colors group-hover:text-ink" />
                      </button>
                    ))}
                  </div>
                </Card>
              )}

              {active.keywords.length > 0 && (
                <Card className="p-5">
                  <div className="flex items-center justify-between">
                    <Label>Matched language</Label>
                    <Braces size={14} className="text-ink-3" />
                  </div>
                  <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    {active.keywords.map((group) => (
                      <div key={group.category}>
                        <div className="flex items-center gap-2">
                          <span className="h-1 w-1 rounded-full bg-accent/70" />
                          <span className="text-[11px] font-medium text-ink-2">{group.category}</span>
                          <span className="mono ml-auto text-[9px] text-ink-3">{group.matches.length}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {group.matches.slice(0, 8).map((match, i) => (
                            <span
                              key={`${match}-${i}`}
                              className="mono rounded border border-line bg-bg-1 px-1.5 py-0.5 text-[10px] text-ink-3"
                            >
                              {match}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-20">
          {active && (
            <>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <Label>Composite risk</Label>
                  <RiskPill label={active.riskLabel} />
                </div>
                <div className="mt-2">
                  <ScoreBlock score={active.score} label={active.riskLabel} />
                </div>
                <div className="mt-4">
                  <ScoreBar score={active.score} segments={32} height={7} />
                </div>
                <div className="mono mt-2 flex justify-between text-[9px] text-ink-3">
                  <span>0</span>
                  <span>30 medium</span>
                  <span>60 high</span>
                  <span>100</span>
                </div>
                <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-2">{active.summary}</p>
                <div className="mono mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[9px] text-ink-3">
                  <span>{triggered.length}/{active.rules.length} RULES</span>
                  <span>{entityCount} INDICATORS</span>
                  <span>{urlCount} LINKS</span>
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <Label>Extracted indicators</Label>
                  <span className="mono text-[9px] text-ink-3">{entityCount} TOTAL</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {active.entities.map((entity, i) => (
                    <EntityChip
                      key={`${entity.type}-${entity.normalized}-${i}`}
                      type={entity.type}
                      value={entity.normalized}
                      note={entity.note}
                      suspicious={entity.suspicious}
                    />
                  ))}
                  {!active.entities.length && <div className="text-[11.5px] text-ink-3">No indicators extracted.</div>}
                </div>
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <Label>Rule ledger</Label>
                  <span className="mono text-[9px] text-ink-3">WEIGHTED · EXPLAINED</span>
                </div>
                <div className="mt-3">
                  <RuleTable rules={active.rules} />
                </div>
              </Card>
            </>
          )}

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Case file</Label>
              <FileText size={13} className="text-ink-3" />
            </div>
            {caseId ? (
              <div className="mt-3 rounded-lg border border-ok/25 bg-ok/[0.06] px-3 py-2.5">
                <div className="flex items-center gap-2 text-[11.5px] text-ok">
                  <CheckCircle2 size={13} />
                  Case opened
                </div>
                <Link
                  to={`/app/cases/${caseId}`}
                  className="mono mt-1 flex items-center gap-1 text-[11px] text-ink-2 transition-colors hover:text-ink"
                >
                  {caseId} <ArrowUpRight size={11} />
                </Link>
              </div>
            ) : (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                Saving preserves the raw message verbatim, links every indicator and opens a case file.
              </p>
            )}

            <div className="mt-3">
              <Label>Case title</Label>
              <input
                className="input mt-1.5 text-[12px]"
                placeholder="Optional — generated from the verdict"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={Boolean(caseId)}
              />
            </div>

            <div className="mt-3 space-y-2">
              {!caseId && (
                <Button variant="primary" className="w-full" onClick={handleSave} disabled={!fresh || saving}>
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {saving ? 'Opening case…' : 'Save as case'}
                </Button>
              )}
              {caseId && (
                <Button variant="primary" className="w-full" onClick={() => navigate(`/app/cases/${caseId}`)}>
                  Open case file <ArrowUpRight size={13} />
                </Button>
              )}
              <Button
                className="w-full"
                onClick={() => {
                  const first = active?.urls[0];
                  if (first) navigate(`/app/url?u=${encodeURIComponent(first.span.value)}`);
                }}
                disabled={!active?.urls.length}
              >
                <ArrowUpRight size={13} />
                Analyse URLs {urlCount > 1 ? `(${urlCount})` : ''}
              </Button>
              <Button className="w-full" onClick={handleExport} disabled={!fresh || exporting}>
                {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {exporting ? 'Building PDF…' : 'Export report PDF'}
              </Button>
            </div>
            <div className="mono mt-3 border-t border-line pt-3 text-[9px] leading-relaxed text-ink-3">
              {active ? `ANALYSED · DETERMINISTIC · NO MODEL` : 'NO ANALYSIS IN BUFFER'}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>Detection coverage</Label>
              <span className="mono text-[9px] text-ink-3">{active ? `${triggered.length}/${active.rules.length}` : '11'}</span>
            </div>
            <div className="mt-3 space-y-1.5">
              {(active ? active.rules : []).map((rule) => (
                <div key={rule.id} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      rule.triggered ? 'bg-danger' : 'bg-[var(--fill-5)]',
                    )}
                  />
                  <span className={cn('min-w-0 flex-1 truncate text-[11px]', rule.triggered ? 'text-ink-2' : 'text-ink-3/70')}>
                    {rule.name}
                  </span>
                  <span className="mono text-[9px] text-ink-3">{CATEGORY_LABEL[rule.category ?? ''] ?? rule.category}</span>
                  <span className="mono w-6 text-right text-[9px] text-ink-3">+{rule.weight}</span>
                </div>
              ))}
              {!fresh && (
                <div className="py-2 text-[11.5px] leading-relaxed text-ink-3">
                  Run an analysis to see which of the eleven deterministic checks fired.
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between">
              <Label>What is measured</Label>
              <ScanLine size={13} className="text-ink-3" />
            </div>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-ink-3">
              <p>
                <span className="text-ink-2">Coercion</span> — urgency, threats, authority pressure.
              </p>
              <p>
                <span className="text-ink-2">Identity</span> — a brand named beside a domain it does not own.
              </p>
              <p>
                <span className="text-ink-2">Money</span> — UPI handles, accounts, payment language.
              </p>
              <p>
                <span className="text-ink-2">Harvesting</span> — OTP, PIN, CVV and document requests.
              </p>
              <p>
                <span className="text-ink-2">Delivery</span> — APK links, shorteners, plain HTTP.
              </p>
            </div>
            <p className="mt-3 border-t border-line pt-3 text-[10px] leading-relaxed text-ink-3">
              A low score is not a certificate of legitimacy. It means these rules did not fire.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
