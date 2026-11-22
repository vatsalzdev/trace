import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Copy, Minus, Plus } from 'lucide-react';
import type { Rule } from '@shared/types';
import { cn } from '@/lib/cn';
import { riskClass, riskColor } from '@/lib/format';
import { useCountUp, useInView } from '@/lib/hooks';

/* -------------------------------- buttons -------------------------------- */

export function Button({
  children,
  variant = 'default',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'accent' | 'ghost' }) {
  const map = { default: 'btn', primary: 'btn btn-primary', accent: 'btn btn-accent', ghost: 'btn btn-ghost' };
  return (
    <button className={cn(map[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* -------------------------------- surfaces ------------------------------- */

export function PageHeader({
  label,
  title,
  description,
  actions,
  children,
}: {
  label: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <div className="label">{label}</div>
        <h1 className="mt-1 text-[28px] font-medium tracking-[-0.035em] text-ink">{title}</h1>
        {description && <div className="mt-1 max-w-[76ch] text-[12px] leading-relaxed text-ink-3">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, spotlight = false }: { children: ReactNode; className?: string; spotlight?: boolean }) {
  return (
    <div
      className={cn('card', spotlight && 'spotlight', className)}
      onMouseMove={
        spotlight
          ? (e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
              e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export function RiskPill({ label, score }: { label?: string; score?: number }) {
  return (
    <span className={riskClass(label)} data-testid="risk-pill">
      <span
        className="inline-block h-1 w-1 rounded-full"
        style={{ background: riskColor(label) }}
      />
      {label ?? 'LOW'}
      {typeof score === 'number' && <span className="opacity-60">{score}</span>}
    </span>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('label', className)}>{children}</div>;
}

/* ------------------------------- segmented ------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex h-8 items-center gap-0.5 rounded-lg border border-line bg-bg-1 p-0.5', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'relative h-full rounded-[6px] px-2.5 text-[11.5px] font-medium transition-colors duration-150',
            value === opt.value ? 'bg-bg-3 text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {opt.label}
          {typeof opt.count === 'number' && <span className="ml-1.5 tabular text-[10px] text-ink-3">{opt.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- score ---------------------------------- */

export function ScoreBar({ score, segments = 24, height = 6 }: { score: number; segments?: number; height?: number }) {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * segments);
  const color = score >= 60 ? 'var(--danger)' : score >= 30 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="seg-bar" style={{ gap: 2 }} aria-label={`Risk score ${score} of 100`}>
      {Array.from({ length: segments }).map((_, i) => (
        <span
          key={i}
          style={{
            height,
            background: i < filled ? color : 'rgba(255,255,255,0.06)',
            opacity: i < filled ? 0.35 + (i / segments) * 0.65 : 1,
            transitionDelay: `${i * 12}ms`,
          }}
        />
      ))}
    </div>
  );
}

export function ScoreBlock({ score, label, size = 'lg' }: { score: number; label?: string; size?: 'sm' | 'lg' }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        className={cn('num font-medium tracking-[-0.05em]', size === 'lg' ? 'text-[54px] leading-none' : 'text-[30px] leading-none')}
        style={{ color: riskColor(label) }}
      >
        {score}
      </span>
      <span className="mono text-[11px] text-ink-3">/100</span>
    </div>
  );
}

/* ------------------------------ rule table ------------------------------- */

export function RuleTable({ rules, emptyText = 'No rules triggered.' }: { rules: Rule[]; emptyText?: string }) {
  const [showAll, setShowAll] = useState(false);
  const triggered = rules.filter((r) => r.triggered);
  const visible = showAll ? rules : triggered;
  if (!rules.length) {
    return <div className="py-6 text-[12.5px] text-ink-3">{emptyText}</div>;
  }
  return (
    <div>
      <div className="flex items-center justify-between border-b border-line pb-2">
        <div className="label">
          {triggered.length} of {rules.length} checks triggered
        </div>
        <button
          onClick={() => setShowAll((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-ink-3 transition-colors hover:text-ink"
        >
          {showAll ? 'Triggered only' : 'Show all checks'}
          <ChevronDown size={12} className={cn('transition-transform', showAll && 'rotate-180')} />
        </button>
      </div>
      <div className="divide-y divide-line/70">
        <AnimatePresence initial={false}>
          {visible.map((rule, index) => (
            <motion.div
              key={rule.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.24), ease: [0.16, 1, 0.3, 1] }}
              className="group py-3"
              data-testid="rule-row"
              data-rule-id={rule.id}
            >
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-[5px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border',
                    rule.triggered ? 'border-danger/40 bg-danger/10 text-danger' : 'border-line text-ink-3',
                  )}
                >
                  {rule.triggered ? <Check size={9} strokeWidth={3} /> : <Minus size={9} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-[13px] font-medium leading-snug text-ink">{rule.name}</div>
                    <span
                      className={cn(
                        'mono shrink-0 rounded-[3px] border px-1.5 py-0.5 text-[10px] tabular',
                        rule.triggered ? 'border-danger/25 bg-danger/[0.07] text-danger' : 'border-line text-ink-3',
                      )}
                    >
                      +{rule.weight}
                    </span>
                  </div>
                  {rule.triggered && rule.evidence.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {rule.evidence.map((ev, i) => (
                        <div key={i} className="mono flex gap-1.5 text-[10.5px] leading-relaxed text-ink-2">
                          <span className="select-none text-ink-3">›</span>
                          <span className="break-all">{ev}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className={cn('mt-1.5 max-w-[62ch] text-[11.5px] leading-relaxed', rule.triggered ? 'text-ink-3' : 'text-ink-3/70')}>
                    {rule.explanation}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {!visible.length && <div className="py-6 text-[12.5px] text-ink-3">{emptyText}</div>}
    </div>
  );
}

/* ------------------------------- sparkline ------------------------------- */

export function Sparkline({ values, color = 'var(--accent)', width = 120, height = 30 }: { values: number[]; color?: string; width?: number; height?: number }) {
  const id = useId().replace(/:/g, '');
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - 3 - ((v - min) / span) * (height - 8);
    return [x, y] as const;
  });
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="min-w-0 max-w-[120px] flex-1 overflow-visible"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
    </svg>
  );
}

export function StatBlock({
  label,
  value,
  suffix,
  spark,
  hint,
  tone = 'default',
}: {
  label: string;
  value: number;
  suffix?: string;
  spark?: number[];
  hint?: string;
  tone?: 'default' | 'danger' | 'accent';
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const animated = useCountUp(value, inView);
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'accent' ? 'var(--accent)' : 'var(--text)';
  return (
    <div ref={ref} className="group relative border-t border-line pt-4">
      <div className="label">{label}</div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="num text-[36px] font-medium leading-none tracking-[-0.045em]" style={{ color }}>
            {Math.round(animated)}
          </span>
          {suffix && <span className="text-[11px] text-ink-3">{suffix}</span>}
        </div>
        {spark && <Sparkline values={spark} color={tone === 'danger' ? 'var(--danger)' : 'var(--accent)'} />}
      </div>
      {hint && <div className="mt-2 text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}

/* -------------------------------- empty ---------------------------------- */

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-line bg-bg-1 px-8 py-16 text-center', className)}>
      <div className="empty-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative z-10">
        {icon && <div className="mx-auto mb-4 text-ink-3">{icon}</div>}
        <div className="text-[15px] font-medium text-ink">{title}</div>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-[12.5px] leading-relaxed text-ink-3">{description}</p>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

/* --------------------------------- misc ---------------------------------- */

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          /* noop */
        }
      }}
      className="inline-flex items-center gap-1 text-[10.5px] text-ink-3 transition-colors hover:text-ink"
      title={label}
    >
      {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-5 border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'relative -mb-px flex items-center gap-1.5 border-b py-2.5 text-[12.5px] transition-colors duration-150',
            value === tab.value ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink-2',
          )}
        >
          {tab.label}
          {typeof tab.count === 'number' && <span className="tabular text-[10px] text-ink-3">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Expandable({
  title,
  meta,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-line last:border-b-0">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 py-3 text-left">
        <span className="min-w-0 flex-1 text-[12.5px] text-ink">{title}</span>
        {meta}
        {open ? <Minus size={12} className="text-ink-3" /> : <Plus size={12} className="text-ink-3" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
