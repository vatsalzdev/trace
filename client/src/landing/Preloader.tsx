import { useEffect, useState } from 'react';

export function Preloader() {
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / 1150);
      setProgress(Math.round(p * 100));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const t1 = window.setTimeout(() => setOpen(true), 1450);
    const t2 = window.setTimeout(() => {
      setDone(true);
      document.body.style.overflow = previous;
    }, 2350);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      document.body.style.overflow = previous;
    };
  }, []);

  if (done) return null;

  return (
    <div className={`preloader-curtain ${open ? 'preloader-open' : ''}`} aria-hidden="true">
      <div className="preloader-half top" />
      <div className="preloader-half bottom" />
      <div
        className="absolute inset-0 z-10 flex flex-col items-center justify-center transition-opacity duration-300"
        style={{ opacity: open ? 0 : 1 }}
      >
        <div className="flex items-baseline gap-[0.08em] text-[clamp(42px,7vw,84px)] font-medium tracking-[0.02em] text-ink">
          {'TRACE'.split('').map((letter, i) => (
            <span
              key={i}
              style={{
                display: 'inline-block',
                opacity: 0,
                transform: 'translateY(14px)',
                animation: `letterIn 700ms cubic-bezier(0.16,1,0.3,1) ${i * 90}ms forwards`,
              }}
            >
              {letter}
            </span>
          ))}
        </div>
        <div className="mt-6 flex w-[220px] items-center gap-4">
          <div className="h-px flex-1 bg-white/10">
            <div
              className="h-px bg-ink transition-[width] duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="mono w-[34px] text-right text-[10px] tabular text-ink-3">
            {String(progress).padStart(3, '0')}
          </span>
        </div>
        <div className="mono mt-5 text-[9px] uppercase tracking-[0.24em] text-ink-3">Establishing local index</div>
      </div>
      <style>{`@keyframes letterIn { to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
}
