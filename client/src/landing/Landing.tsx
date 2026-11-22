import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Check, FileText, GitBranch, PackageSearch, ScanLine, ShieldCheck } from 'lucide-react';
import { analyzeMessage, SAMPLE_MESSAGES } from '@shared/message';
import { HighlightedText } from '@/components/HighlightedText';
import { ScoreBar } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ENTITY_META, riskClass } from '@/lib/format';
import { useInView, usePrefersReducedMotion } from '@/lib/hooks';
import { ConsoleMock } from './ConsoleMock';
import { Preloader } from './Preloader';

/* ------------------------------ small pieces ----------------------------- */

function Magnetic({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) > rect.width / 2 + 80) return;
    el.style.transform = `translate3d(${dx * 0.12}px, ${dy * 0.12}px, 0)`;
  };
  const reset = () => {
    if (ref.current) ref.current.style.transform = 'translate3d(0,0,0)';
  };
  return (
    <span
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className={cn('inline-block transition-transform duration-300 ease-expo', className)}
      style={{ willChange: 'transform' }}
    >
      {children}
    </span>
  );
}

function BigNumber({ value, suffix, label, note }: { value: number; suffix?: string; label: string; note: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1000);
      setDisplay(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);
  return (
    <div ref={ref} className="border-t border-line pt-5">
      <div className="num flex items-baseline text-[clamp(40px,5vw,64px)] font-medium leading-none tracking-[-0.05em] text-ink">
        {display}
        {suffix && <span className="ml-1 text-[clamp(20px,2.4vw,30px)] text-ink-3">{suffix}</span>}
      </div>
      <div className="mt-3 text-[13px] font-medium text-ink-2">{label}</div>
      <div className="mt-1 max-w-[28ch] text-[12px] leading-relaxed text-ink-3">{note}</div>
    </div>
  );
}

function SectionHead({
  label,
  title,
  body,
  align = 'left',
}: {
  label: string;
  title: React.ReactNode;
  body?: string;
  align?: 'left' | 'between';
}) {
  return (
    <div className={cn('flex flex-col gap-8 md:flex-row md:items-end md:justify-between', align === 'left' && 'md:flex-col md:items-start')}>
      <div className="max-w-[760px]">
        <div className="label">{label}</div>
        <h2 className="mt-4 text-[clamp(36px,5vw,66px)] font-medium leading-[0.98] tracking-[-0.045em] text-ink" data-reveal>
          {title}
        </h2>
      </div>
      {body && (
        <p className="max-w-[38ch] text-[14px] leading-relaxed text-ink-2 md:pb-2" data-reveal>
          {body}
        </p>
      )}
    </div>
  );
}

/* -------------------------------- landing -------------------------------- */

const MARQUEE = [
  'UPI IDs',
  'APK permissions',
  'registrable domains',
  'Indian phone numbers',
  'IFSC codes',
  'crypto wallets',
  'redirect chains',
  'RDAP records',
  'TLS issuers',
  'Telegram handles',
  'bank account numbers',
  'AXML manifests',
  'typosquat labels',
  'OTP harvest patterns',
];

const FLOW = [
  {
    id: 'ingest',
    title: 'Ingest',
    copy: 'Paste an SMS, drop a link, or upload an APK. Nothing is normalised away — the original bytes and text are retained verbatim.',
  },
  {
    id: 'extract',
    title: 'Extract',
    copy: 'Deterministic extractors pull domains, UPI handles, phones, wallets and permissions. Every match keeps its character span.',
  },
  {
    id: 'correlate',
    title: 'Correlate',
    copy: 'Indicators are normalised into one entity index. Reuse across cases becomes an edge you can see and defend.',
  },
  {
    id: 'report',
    title: 'Report',
    copy: 'A print-ready PDF is generated from the case data, with the rule weights, evidence and a SHA-256 integrity hash.',
  },
];

export default function Landing() {
  const reduce = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(false);
  const [flowStep, setFlowStep] = useState(0);
  const heroVisual = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const flowLine = useRef<HTMLDivElement>(null);
  const flowStepRef = useRef(0);

  const demoAnalysis = useMemo(() => analyzeMessage(SAMPLE_MESSAGES[0].text), []);

  useEffect(() => {
    if (reduce) {
      setRevealed(true);
      return;
    }
    const timer = window.setTimeout(() => setRevealed(true), 1450);
    return () => window.clearTimeout(timer);
  }, [reduce]);

  // Lenis + GSAP ScrollTrigger, loaded lazily so the landing bundle stays small.
  useEffect(() => {
    if (reduce) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const [gsapMod, stMod, lenisMod] = await Promise.all([
          import('gsap'),
          import('gsap/ScrollTrigger'),
          import('lenis'),
        ]);
        if (disposed) return;
        const gsap = (gsapMod as any).gsap ?? (gsapMod as any).default;
        const ScrollTrigger = (stMod as any).ScrollTrigger ?? (stMod as any).default;
        const Lenis = (lenisMod as any).default;
        gsap.registerPlugin(ScrollTrigger);

        const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.95 });
        let raf = 0;
        const loop = (time: number) => {
          lenis.raf(time);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        lenis.on('scroll', ScrollTrigger.update);

        const ctx = gsap.context(() => {
          (gsap.utils.toArray('[data-reveal]') as HTMLElement[]).forEach((el) => {
            gsap.fromTo(
              el,
              { opacity: 0, y: 28 },
              {
                opacity: 1,
                y: 0,
                duration: 0.9,
                ease: 'power3.out',
                scrollTrigger: { trigger: el, start: 'top 88%' },
              },
            );
          });
          (gsap.utils.toArray('[data-stagger]') as HTMLElement[]).forEach((group) => {
            const items = group.querySelectorAll<HTMLElement>('[data-stagger-item]');
            gsap.fromTo(
              items,
              { opacity: 0, y: 20 },
              {
                opacity: 1,
                y: 0,
                duration: 0.8,
                stagger: 0.08,
                ease: 'power3.out',
                scrollTrigger: { trigger: group, start: 'top 84%' },
              },
            );
          });

          const flow = flowRef.current;
          if (flow && window.matchMedia('(min-width: 901px)').matches) {
            const pin = flow.querySelector('.flow-pin');
            ScrollTrigger.create({
              trigger: flow,
              start: 'top top',
              end: '+=160%',
              pin,
              pinSpacing: true,
              scrub: true,
              onUpdate: (self: any) => {
                if (flowLine.current) flowLine.current.style.setProperty('--progress', String(self.progress));
                const next = Math.min(3, Math.floor(self.progress * 4.05));
                if (next !== flowStepRef.current) {
                  flowStepRef.current = next;
                  setFlowStep(next);
                }
              },
            });
          } else if (flowLine.current) {
            flowLine.current.style.setProperty('--progress', '1');
          }
        });

        cleanup = () => {
          ctx.revert();
          cancelAnimationFrame(raf);
          lenis.destroy();
        };
      } catch (error) {
        console.warn('[trace] landing motion unavailable', error);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [reduce]);

  const onHeroMove = (e: React.MouseEvent) => {
    if (reduce) return;
    const el = heroVisual.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - (rect.left + rect.width / 2)) / rect.width;
    const y = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
    el.style.transform = `rotateX(54deg) rotateZ(-12deg) translate3d(${x * 10}px, ${y * 8}px, 0)`;
  };
  const onHeroLeave = () => {
    if (heroVisual.current) heroVisual.current.style.transform = 'rotateX(54deg) rotateZ(-12deg) translate3d(0,0,0)';
  };

  return (
    <div className="relative overflow-x-hidden">
      {!reduce && <Preloader />}

      {/* nav */}
      <header className="fixed inset-x-0 top-0 z-[120]">
        <div className="glass border-x-0 border-t-0">
          <div className="mx-auto flex h-14 max-w-[1180px] items-center justify-between px-5 lg:px-8">
            <Link to="/" className="flex items-baseline gap-2.5">
              <span className="text-[13px] font-semibold tracking-[0.2em] text-ink">TRACE</span>
              <span className="mono hidden text-[8px] uppercase tracking-[0.16em] text-ink-3 sm:block">
                cybercrime intelligence
              </span>
            </Link>
            <nav className="hidden items-center gap-7 text-[12.5px] text-ink-2 md:flex">
              <a href="#method" className="link-underline transition-colors hover:text-ink">Method</a>
              <a href="#flow" className="link-underline transition-colors hover:text-ink">Investigation flow</a>
              <a href="#analysis" className="link-underline transition-colors hover:text-ink">Live analysis</a>
            </nav>
            <div className="flex items-center gap-3">
              <span className="mono hidden items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-ink-3 lg:flex">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ok" />
                engine v1.0
              </span>
              <Magnetic>
                <Link to="/app" className="btn btn-primary h-8 px-3.5 text-[12px]">
                  Open console <ArrowUpRight size={13} />
                </Link>
              </Magnetic>
            </div>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative mx-auto max-w-[1180px] px-5 pb-10 pt-[132px] lg:px-8 lg:pt-[152px]">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div className="mono flex items-center gap-2 text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
            <span className="h-1 w-1 rounded-full bg-accent" />
            Investigation console for cybercrime cells
          </div>
          <div className="mono hidden text-[9.5px] uppercase tracking-[0.14em] text-ink-3 sm:block">
            India · 2026
          </div>
        </div>

        <h1 className="display mt-10 max-w-[1020px] text-[clamp(48px,8vw,118px)] text-ink">
          <span className="reveal-line">
            <span style={revealed ? { animation: 'lineUp 900ms var(--ease) 60ms both' } : { transform: 'translateY(110%)' }}>
              Every fraud leaves
            </span>
          </span>
          <span className="reveal-line">
            <span
              className="flex items-baseline gap-[0.16em]"
              style={revealed ? { animation: 'lineUp 900ms var(--ease) 140ms both' } : { transform: 'translateY(110%)' }}
            >
              <span>a</span>
              <em className="font-serif font-normal not-italic" style={{ fontStyle: 'italic', letterSpacing: '-0.02em' }}>
                trace
              </em>
              <span>.</span>
            </span>
          </span>
        </h1>

        <div className="mt-9 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <p
            className="max-w-[50ch] text-[15px] leading-[1.7] text-ink-2"
            style={revealed ? { animation: 'fadeUp 800ms var(--ease) 320ms both' } : { opacity: 0 }}
          >
            Messages, links and Android packages resolved into one connected case file. Deterministic rules, visible
            evidence, no black boxes. Built for the people who have to explain a finding in court.
          </p>
          <div
            className="flex shrink-0 items-center gap-3"
            style={revealed ? { animation: 'fadeUp 800ms var(--ease) 420ms both' } : { opacity: 0 }}
          >
            <Magnetic>
              <Link to="/app" className="btn btn-primary h-10 px-4">
                Open console <ArrowRight size={14} />
              </Link>
            </Magnetic>
            <a href="#method" className="btn btn-ghost h-10 px-2 text-[13px] text-ink-2">
              Read the method
            </a>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4">
          {[
            ['11', 'deterministic message rules'],
            ['0', 'ML or generative models'],
            ['4s', 'network budget, then fixtures'],
          ].map(([n, label]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="num text-[13px] font-medium text-ink">{n}</span>
              <span className="text-[11px] text-ink-3">{label}</span>
            </div>
          ))}
        </div>

        {/* tilted console */}
        <div
          className="relative mt-14 hidden md:block"
          style={{ perspective: '1700px', perspectiveOrigin: '50% 0%' }}
          onMouseMove={onHeroMove}
          onMouseLeave={onHeroLeave}
        >
          <div
            ref={heroVisual}
            className="relative mx-auto w-[min(1080px,92vw)] origin-top transition-transform duration-500 ease-expo"
            style={{ transform: 'rotateX(54deg) rotateZ(-12deg) translate3d(0,0,0)' }}
          >
            <ConsoleMock />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 -bottom-2 flex justify-center">
            <div className="h-px w-[60%] bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          </div>
        </div>
        <div className="mt-10 flex justify-center md:hidden">
          <Link to="/app" className="btn btn-primary h-10 px-5">
            Open the console <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* marquee */}
      <section className="border-y border-line py-5">
        <div className="marquee-mask overflow-hidden">
          <div className="marquee-track gap-0">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center">
                {MARQUEE.map((item) => (
                  <span key={`${copy}-${item}`} className="flex items-center gap-3 px-6">
                    <span className="h-1 w-1 rounded-full bg-ink-3/60" />
                    <span className="mono whitespace-nowrap text-[10.5px] uppercase tracking-[0.13em] text-ink-3">{item}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* method */}
      <section id="method" className="mx-auto max-w-[1180px] scroll-mt-20 px-5 py-24 lg:px-8 lg:py-30">
        <SectionHead
          label="The method"
          title={
            <>
              Three artefacts. One <em className="font-serif font-normal italic">case</em> file.
            </>
          }
          body="Each engine is a set of written rules. Nothing is inferred by a model, and every point on the score can be traced back to a span of the original evidence."
          align="between"
        />

        <div className="mt-14 grid gap-4 md:grid-cols-3" data-stagger>
          {[
            {
              icon: ScanLine,
              kicker: '01 / Message',
              title: 'Read the language',
              copy: 'Extract URLs, UPI handles, phones and wallets. Weigh coercion, impersonation and credential requests against a brand-domain mismatch.',
              visual: (
                <div className="space-y-2">
                  {[
                    ['Urgency language', '+15', '“will be blocked today”'],
                    ['Brand impersonation', '+25', 'SBI ≠ sbi-kyc-verify.example.com'],
                    ['Credential harvest', '+15', '“share OTP”'],
                  ].map(([name, weight, ev]) => (
                    <div key={name} className="flex items-start gap-2 border-b border-line/70 pb-2 last:border-0">
                      <Check size={10} className="mt-1 shrink-0 text-danger" />
                      <div className="min-w-0 flex-1">
                        <div className="flex justify-between gap-2 text-[11px] text-ink-2">
                          <span>{name}</span>
                          <span className="mono text-[10px] text-danger">{weight}</span>
                        </div>
                        <div className="mono mt-0.5 truncate text-[9px] text-ink-3">{ev}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              icon: GitBranch,
              kicker: '02 / URL',
              title: 'Resolve the destination',
              copy: 'Parse the registrable domain, measure edit distance to real brands, follow redirects, and check RDAP, DNS and TLS within a hard four-second budget.',
              visual: (
                <div>
                  <div className="mono flex flex-wrap items-center gap-0.5 text-[10px]">
                    <span className="text-ink-3">http://</span>
                    <span className="rounded-sm bg-danger/15 px-1 text-danger">sbi-secure-login</span>
                    <span className="text-ink-3">.</span>
                    <span className="rounded-sm bg-warn/15 px-1 text-warn">xyz</span>
                    <span className="text-ink-3">/verify</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
                    <span className="mono text-[9px] uppercase tracking-wider text-ink-3">typosquat · TLD · HTTP</span>
                    <span className="mono text-[11px] text-danger">100</span>
                  </div>
                  <div className="mt-2">
                    <ScoreBar score={100} segments={16} height={4} />
                  </div>
                </div>
              ),
            },
            {
              icon: PackageSearch,
              kicker: '03 / APK',
              title: 'Open the package',
              copy: 'Decode the binary AndroidManifest, score dangerous permission combinations, and pull C2 endpoints and payment handles out of the embedded files.',
              visual: (
                <div className="space-y-1.5">
                  {[
                    ['READ_SMS', 16],
                    ['SYSTEM_ALERT_WINDOW', 18],
                    ['BIND_ACCESSIBILITY_SERVICE', 22],
                    ['REQUEST_INSTALL_PACKAGES', 12],
                  ].map(([name, weight]) => (
                    <div key={String(name)} className="flex items-center gap-2">
                      <span className="h-1 w-1 rounded-full bg-warn" />
                      <span className="mono flex-1 truncate text-[9px] text-ink-2">{name}</span>
                      <span className="mono text-[9px] text-ink-3">+{weight}</span>
                    </div>
                  ))}
                  <div className="mono mt-2 border-t border-line pt-2 text-[9px] text-danger">
                    banker-trojan pattern · +30
                  </div>
                </div>
              ),
            },
          ].map((card) => (
            <div
              key={card.title}
              data-stagger-item
              className="card spotlight hairline flex flex-col p-6"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
                e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
              }}
            >
              <card.icon size={16} className="text-ink-3" />
              <div className="label mt-5">{card.kicker}</div>
              <h3 className="mt-2 text-[19px] font-medium tracking-[-0.025em] text-ink">{card.title}</h3>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{card.copy}</p>
              <div className="mt-6 border-t border-line pt-4">{card.visual}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-5 text-[12px] text-ink-3 md:flex-row md:items-center md:justify-between" data-reveal>
          <span className="flex items-center gap-2">
            <ShieldCheck size={13} />
            No LLM, no external AI API, no probabilistic scoring.
          </span>
          <span className="mono text-[10px] uppercase tracking-[0.12em]">weights are published · evidence is retained</span>
        </div>
      </section>

      {/* flow */}
      <section id="flow" ref={flowRef} className="relative scroll-mt-0 border-y border-line bg-bg-1/40">
        <div className="flow-pin mx-auto flex min-h-screen max-w-[1180px] flex-col justify-center px-5 py-20 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div>
              <div className="label">How an investigation flows</div>
              <h2 className="mt-4 text-[clamp(38px,5vw,62px)] font-medium leading-[0.98] tracking-[-0.045em] text-ink" data-reveal>
                Ingest. Extract.
                <br />
                Correlate. <em className="font-serif font-normal italic">Report.</em>
              </h2>
              <p className="mt-5 max-w-[38ch] text-[13.5px] leading-relaxed text-ink-2">
                The same four steps every time. The console does not skip to a verdict; it shows the chain that produced
                one.
              </p>
              <div className="mono mt-8 hidden items-center gap-2 text-[9.5px] uppercase tracking-[0.13em] text-ink-3 lg:flex">
                <span className="h-1 w-1 rounded-full bg-accent" />
                scroll to advance
              </div>
            </div>

            <div className="relative">
              <div className="flow-line" />
              <div ref={flowLine} className="flow-line-fill" style={{ bottom: 10, height: 'calc(100% - 20px)' }} />
              <div className="space-y-1">
                {FLOW.map((step, index) => (
                  <button
                    key={step.id}
                    onClick={() => setFlowStep(index)}
                    className={cn(
                      'relative block w-full rounded-lg border px-5 py-4 text-left transition-colors duration-300',
                      flowStep === index ? 'border-line-2 bg-bg-2' : 'border-transparent hover:bg-white/[0.02]',
                    )}
                    style={{ marginLeft: 0 }}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={cn(
                          'mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[8.5px] transition-colors',
                          flowStep === index ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line text-ink-3',
                        )}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={cn('text-[15px] font-medium tracking-[-0.02em]', flowStep === index ? 'text-ink' : 'text-ink-3')}>
                            {step.title}
                          </span>
                          <span className="mono text-[8.5px] uppercase tracking-[0.12em] text-ink-3">
                            {flowStep === index ? 'active' : 'queued'}
                          </span>
                        </div>
                        <p className={cn('mt-1 max-w-[46ch] text-[11.5px] leading-relaxed', flowStep === index ? 'text-ink-2' : 'text-ink-3/70')}>
                          {step.copy}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-5 min-h-[210px] rounded-xl border border-line bg-bg-2 p-5">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={FLOW[flowStep]?.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {flowStep === 0 && (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="label">Raw evidence</span>
                          <span className="mono text-[9px] text-ink-3">SMS · 148 chars</span>
                        </div>
                        <p className="mono mt-3 text-[11px] leading-[1.9] text-ink-2">
                          <HighlightedText text={SAMPLE_MESSAGES[0].text} entities={demoAnalysis.entities} />
                        </p>
                      </div>
                    )}
                    {flowStep === 1 && (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="label">Rule weights</span>
                          <span className="mono text-[9px] text-danger">score {demoAnalysis.score}</span>
                        </div>
                        <div className="mt-2">
                          {demoAnalysis.rules
                            .filter((r) => r.triggered)
                            .slice(0, 4)
                            .map((r) => (
                              <div key={r.id} className="flex items-center gap-2 border-b border-line/70 py-1.5 last:border-0">
                                <span className="h-1 w-1 rounded-full bg-danger" />
                                <span className="flex-1 truncate text-[11px] text-ink-2">{r.name}</span>
                                <span className="mono text-[9.5px] text-danger">+{r.weight}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                    {flowStep === 2 && (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="label">Entity reuse</span>
                          <span className="mono text-[9px] text-accent">5 cases</span>
                        </div>
                        <svg viewBox="0 0 420 140" className="mt-2 w-full">
                          {[
                            [210, 70, 70, 30],
                            [210, 70, 320, 26],
                            [210, 70, 340, 112],
                            [210, 70, 90, 118],
                            [210, 70, 60, 30],
                          ].map(([x1, y1, x2, y2], i) => (
                            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
                          ))}
                          {[
                            [70, 30, '#8b8bff'],
                            [320, 26, '#ff5d5d'],
                            [340, 112, '#ffb454'],
                            [90, 118, '#60a5fa'],
                            [60, 30, '#a78bfa'],
                          ].map(([x, y, color], i) => (
                            <circle key={i} cx={x as number} cy={y as number} r="5" fill={color as string} fillOpacity="0.85" />
                          ))}
                          <circle cx="210" cy="70" r="10" fill="rgba(139,139,255,0.16)" stroke="#8b8bff" strokeWidth="1" />
                          <text x="210" y="95" textAnchor="middle" fill="#9a9aa3" fontSize="7" fontFamily="monospace">
                            kyc.support@fakebank
                          </text>
                        </svg>
                      </div>
                    )}
                    {flowStep === 3 && (
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="label">Generated report</span>
                          <span className="mono text-[9px] text-ink-3">PDF · 9 sections</span>
                        </div>
                        <div className="mt-3 rounded-md border border-line bg-[#f4f4f6] p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-bold tracking-[0.2em] text-[#101014]">TRACE</span>
                            <span className="mono text-[6px] text-[#6c6c76]">TRC-2026-0001</span>
                          </div>
                          <div className="mt-1 h-px w-8 bg-[#6e6eeb]" />
                          <div className="mt-2 h-1.5 w-3/4 rounded-sm bg-[#101014]/80" />
                          <div className="mt-1 h-1 w-1/2 rounded-sm bg-[#101014]/20" />
                          <div className="mt-2 grid grid-cols-3 gap-1">
                            {[0, 1, 2].map((i) => (
                              <div key={i} className="h-5 rounded-sm border border-[#e2e2e8] bg-white/60" />
                            ))}
                          </div>
                          <div className="mono mt-2 text-[5px] text-[#8a8a94]">SHA-256 · integrity hash appended</div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* live analysis */}
      <section id="analysis" className="mx-auto max-w-[1180px] scroll-mt-20 px-5 py-24 lg:px-8 lg:py-30">
        <SectionHead
          label="Live analysis"
          title={
            <>
              The demo is the <em className="font-serif font-normal italic">engine</em>.
            </>
          }
          body="This panel runs the same shared code as the console, in your browser. No network request, no pre-computed result."
          align="between"
        />
        <LiveAnalysis analysis={demoAnalysis} />
      </section>

      {/* proof */}
      <section className="border-y border-line bg-bg-1/30">
        <div className="mx-auto max-w-[1180px] px-5 py-20 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <h2 className="max-w-[720px] text-[clamp(34px,4.6vw,58px)] font-medium leading-[1.02] tracking-[-0.045em] text-ink" data-reveal>
              Built to be <em className="font-serif font-normal italic">checked</em>, not trusted.
            </h2>
            <p className="max-w-[34ch] text-[13px] leading-relaxed text-ink-3" data-reveal>
              A score is only useful if someone can challenge it. Every number in TRACE resolves to a rule, a weight and
              a matched span.
            </p>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <BigNumber value={11} label="Message rules" note="Each with a published weight and a written rationale." />
            <BigNumber value={0} label="ML models" note="No classifier, no embedding, no external inference." />
            <BigNumber value={4} suffix="s" label="Network budget" note="RDAP, DNS, TLS and redirects time out to fixtures." />
            <BigNumber value={100} label="Score cap" note="Weights sum to a bounded score; evidence stays attached." />
          </div>
        </div>
      </section>

      {/* closing */}
      <section className="mx-auto max-w-[1180px] px-5 py-24 lg:px-8 lg:py-32">
        <div className="grid gap-10 border-t border-line pt-12 md:grid-cols-[1.2fr_0.8fr] md:items-end">
          <div>
            <div className="label">Ready when the complaint lands</div>
            <h2 className="mt-4 max-w-[16ch] text-[clamp(40px,6vw,78px)] font-medium leading-[0.95] tracking-[-0.05em] text-ink">
              Open the <em className="font-serif font-normal italic">console</em>.
            </h2>
            <p className="mt-5 max-w-[46ch] text-[14px] leading-relaxed text-ink-2">
              Fourteen seeded cases, a real APK to unpack, and a graph that already shows one UPI handle reused across
              five files. Start from any of them.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <Magnetic>
              <Link to="/app" className="btn btn-primary h-11 px-5 text-[13.5px]">
                Open console <ArrowRight size={15} />
              </Link>
            </Magnetic>
            <Link to="/app/scan" className="link-underline text-[12px] text-ink-3 transition-colors hover:text-ink">
              or paste a message first
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1180px] px-5 py-10 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[12px] font-semibold tracking-[0.22em] text-ink">TRACE</div>
              <p className="mt-2 max-w-[52ch] text-[11.5px] leading-relaxed text-ink-3">
                Cybercrime investigation and threat intelligence. Deterministic rule-based analysis; no machine learning
                used. Network lookups fall back to local fixtures after four seconds.
              </p>
            </div>
            <div className="mono flex flex-wrap gap-x-6 gap-y-2 text-[10px] uppercase tracking-[0.12em] text-ink-3">
              <Link to="/app" className="transition-colors hover:text-ink">Console</Link>
              <Link to="/app/reports" className="transition-colors hover:text-ink">Reports</Link>
              <a href="#method" className="transition-colors hover:text-ink">Method</a>
              <span>Local index · v1.0</span>
            </div>
          </div>
          <div className="mono mt-8 flex flex-col gap-2 border-t border-line pt-4 text-[9.5px] text-ink-3 sm:flex-row sm:justify-between">
            <span>© 2026 TRACE · investigation tooling</span>
            <span>Report to 1930 · cybercrime.gov.in</span>
          </div>
        </div>
      </footer>

      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}

/* ------------------------------ live analysis ---------------------------- */

function LiveAnalysis({ analysis: seed }: { analysis: ReturnType<typeof analyzeMessage> }) {
  const reduce = usePrefersReducedMotion();
  const [sampleIndex, setSampleIndex] = useState(0);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);

  const full = SAMPLE_MESSAGES[sampleIndex]?.text ?? '';

  useEffect(() => {
    if (reduce) {
      setText(full);
      setTyping(false);
      return;
    }
    setText('');
    setTyping(true);
    let index = 0;
    const timer = window.setInterval(() => {
      index += 2;
      setText(full.slice(0, index));
      if (index >= full.length) {
        window.clearInterval(timer);
        setTyping(false);
      }
    }, 26);
    return () => window.clearInterval(timer);
  }, [sampleIndex, full, reduce]);

  const analysis = useMemo(() => (text.trim() ? analyzeMessage(text) : seed), [text, seed]);
  const triggered = analysis.rules.filter((r) => r.triggered);

  return (
    <div className="mt-12 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">shared engine · client-side</span>
          <span className="ml-auto mono text-[9px] text-ink-3">analyzeMessage()</span>
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
          {SAMPLE_MESSAGES.slice(0, 4).map((sample, i) => (
            <button
              key={sample.id}
              onClick={() => setSampleIndex(i)}
              className={cn(
                'rounded-md border px-2 py-1 text-[10.5px] transition-colors',
                i === sampleIndex ? 'border-line-2 bg-bg-3 text-ink' : 'border-line text-ink-3 hover:text-ink-2',
              )}
            >
              {sample.label}
            </button>
          ))}
        </div>
        <div className="relative min-h-[190px] px-4 py-4">
          <p className="mono whitespace-pre-wrap break-words text-[12px] leading-[2] text-ink-2">
            <HighlightedText text={text} entities={analysis.entities} />
            {typing && <span className="caret" />}
          </p>
          {!text && <p className="mono text-[12px] text-ink-3">Paste a message to analyse…</p>}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <span className="mono text-[9px] uppercase tracking-[0.12em] text-ink-3">extracted</span>
          <div className="flex flex-wrap gap-1.5">
            {analysis.entities
              .filter((e) => ['domain', 'upi', 'phone', 'url'].includes(e.type))
              .slice(0, 4)
              .map((e, i) => (
                <span key={`${e.type}-${i}`} className="mono flex items-center gap-1 text-[9.5px] text-ink-3">
                  <span className="h-1 w-1 rounded-full" style={{ background: ENTITY_META[e.type]?.color }} />
                  {e.value}
                </span>
              ))}
          </div>
          <span className="ml-auto mono text-[9px] text-ink-3">{analysis.entities.length} total</span>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="label">Computed score</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className="num text-[46px] font-medium leading-none tracking-[-0.05em]"
                style={{ color: analysis.score >= 60 ? 'var(--danger)' : analysis.score >= 30 ? 'var(--warn)' : 'var(--ok)' }}
              >
                {analysis.score}
              </span>
              <span className="mono text-[10px] text-ink-3">/100</span>
            </div>
          </div>
          <span className={riskClass(analysis.riskLabel)}>
            <span className="h-1 w-1 rounded-full" style={{ background: analysis.score >= 60 ? 'var(--danger)' : analysis.score >= 30 ? 'var(--warn)' : 'var(--ok)' }} />
            {analysis.riskLabel}
          </span>
        </div>
        <div className="mt-4">
          <ScoreBar score={analysis.score} segments={20} />
        </div>
        <div className="mono mt-2 flex justify-between text-[9px] text-ink-3">
          <span>{triggered.length} rules · weights capped at 100</span>
          <span>{analysis.riskLabel === 'LOW' ? 'no escalation' : 'escalate'}</span>
        </div>

        <div className="mt-5 border-t border-line pt-3">
          <div className="label">Why</div>
          <div className="mt-2 space-y-1.5">
            {triggered.slice(0, 4).map((rule) => (
              <div key={rule.id} className="flex items-start gap-2">
                <span className="mono mt-0.5 shrink-0 text-[9px] text-danger">+{rule.weight}</span>
                <div className="min-w-0">
                  <div className="text-[11.5px] text-ink-2">{rule.name}</div>
                  <div className="mono truncate text-[9px] text-ink-3">{rule.evidence[0]}</div>
                </div>
              </div>
            ))}
            {!triggered.length && <div className="text-[11.5px] text-ink-3">No rules triggered. Low-risk control.</div>}
          </div>
        </div>

        <Link to="/app/scan" className="btn mt-5 w-full justify-between">
          Open full scanner
          <ArrowUpRight size={13} />
        </Link>
      </div>
    </div>
  );
}
