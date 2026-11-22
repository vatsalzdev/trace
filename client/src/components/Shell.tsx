import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  Info,
  LayoutDashboard,
  Moon,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Search,
  Sun,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/hooks';
import {
  applyConsoleTheme,
  clearConsoleTheme,
  otherTheme,
  persistTheme,
  resolveTheme,
  type Theme,
} from '@/lib/theme';
import { CommandPalette } from './CommandPalette';
import { Kbd } from './ui';

const NAV = [
  { to: '/app', label: 'Command Center', icon: LayoutDashboard, key: 'C', end: true },
  { to: '/app/scan', label: 'Message Scanner', icon: ScanLine, key: 'S' },
  { to: '/app/url', label: 'URL Intelligence', icon: Globe2, key: 'U' },
  { to: '/app/apk', label: 'APK Inspector', icon: PackageSearch, key: 'A' },
  { to: '/app/graph', label: 'Relationship Graph', icon: GitBranch, key: 'G' },
  { to: '/app/cases', label: 'Cases', icon: FolderOpen, key: 'K' },
  { to: '/app/reports', label: 'Reports', icon: FileText, key: 'R' },
];

const SHORTCUTS: Record<string, string> = {
  c: '/app',
  s: '/app/scan',
  u: '/app/url',
  a: '/app/apk',
  g: '/app/graph',
  k: '/app/cases',
  r: '/app/reports',
};

function breadcrumb(pathname: string): { parent: string; current: string } {
  if (pathname === '/app') return { parent: 'Console', current: 'Command Center' };
  if (pathname.startsWith('/app/cases/')) return { parent: 'Cases', current: pathname.split('/').pop() ?? '' };
  const match = NAV.find((n) => n.to !== '/app' && pathname.startsWith(n.to));
  return { parent: 'Console', current: match?.label ?? 'Command Center' };
}

export function Shell() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('trace:rail') === '1';
    } catch {
      return false;
    }
  });
  const [theme, setTheme] = useState<Theme>(resolveTheme);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const isMobile = useMediaQuery('(max-width: 900px)');
  const location = useLocation();
  const navigate = useNavigate();
  const rail = collapsed || isMobile;
  const crumb = breadcrumb(location.pathname);

  useEffect(() => {
    try {
      localStorage.setItem('trace:rail', collapsed ? '1' : '0');
    } catch {
      /* rail state is cosmetic when storage is unavailable */
    }
  }, [collapsed]);

  useEffect(() => {
    applyConsoleTheme(theme);
    persistTheme(theme);
    return clearConsoleTheme;
  }, [theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    let pending = false;
    let timer = 0;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'g') {
        window.clearTimeout(timer);
        if (pending) {
          e.preventDefault();
          navigate(SHORTCUTS.g);
          pending = false;
        } else {
          pending = true;
          timer = window.setTimeout(() => {
            pending = false;
          }, 900);
        }
        return;
      }
      if (pending) {
        const to = SHORTCUTS[e.key.toLowerCase()];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
        pending = false;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <div className="console min-h-screen bg-bg" data-theme={theme} data-testid="console-root">
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-line bg-bg transition-[width] duration-200',
          rail ? 'w-[64px]' : 'w-[232px]',
        )}
      >
        <div className={cn('flex h-14 items-center border-b border-line', rail ? 'justify-center px-2' : 'justify-between px-4')}>
          {!rail && (
            <NavLink to="/" className="flex items-baseline gap-2">
              <span className="text-[14px] font-semibold tracking-[0.16em] text-ink">TRACE</span>
              <span className="mono text-[8px] uppercase tracking-[0.16em] text-ink-3">v1.0</span>
            </NavLink>
          )}
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="text-ink-3 transition-colors hover:text-ink"
            aria-label={rail ? 'Expand navigation' : 'Collapse navigation'}
            title={rail ? 'Expand navigation' : 'Collapse navigation'}
          >
            {rail ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-4">
          {!rail && <div className="label px-2 pb-2">Workspace</div>}
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group relative flex h-9 items-center gap-2.5 rounded-md text-[12.5px] transition-colors duration-150',
                  rail ? 'justify-center px-0' : 'px-2.5',
                  isActive ? 'bg-bg-2 text-ink' : 'text-ink-3 hover:bg-[var(--fill-1)] hover:text-ink-2',
                )
              }
              title={rail ? item.label : undefined}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-2 h-5 w-[2px] rounded-r bg-accent" />}
                  <item.icon size={15} strokeWidth={isActive ? 1.9 : 1.6} className="shrink-0" />
                  {!rail && (
                    <>
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <Kbd>G</Kbd>
                        <Kbd>{item.key}</Kbd>
                      </span>
                    </>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className={cn('border-t border-line py-3', rail ? 'px-2' : 'px-4')}>
          {!rail ? (
            <>
              <div className="label">Analyst</div>
              <div className="mt-1.5 text-[12px] text-ink-2">Cyber Crime Cell</div>
              <div className="mono mt-0.5 text-[10px] text-ink-3">ANL-04 · local index</div>
              <div className="mt-3 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-ok/80" />
                <span className="mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">deterministic engine</span>
              </div>
            </>
          ) : (
            <div className="flex justify-center">
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-bg-2 text-[10px] text-ink-2">
                04
              </span>
            </div>
          )}
        </div>
      </aside>

      <div className="transition-[margin] duration-200" style={{ marginLeft: rail ? 64 : 232 }}>
        <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-line bg-bg/90 px-5 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-2 text-[12px]">
            <span className="text-ink-3">{crumb.parent}</span>
            <ChevronRight size={12} className="text-ink-3/60" />
            <span className="truncate font-medium text-ink">{crumb.current}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="group flex h-8 w-[236px] items-center gap-2 rounded-lg border border-line bg-bg-1 px-2.5 text-left transition-colors hover:border-line-2"
            >
              <Search size={13} className="text-ink-3" />
              <span className="flex-1 text-[11.5px] text-ink-3">Search cases, indicators…</span>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </button>
            <button
              onClick={() => setTheme((value) => otherTheme(value))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg-1 text-ink-2 transition-colors hover:border-line-2 hover:text-ink"
              aria-label={`Switch to ${otherTheme(theme)} mode`}
              title={`Switch to ${otherTheme(theme)} mode`}
              data-testid="theme-toggle"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <div className="flex items-center gap-2 border-l border-line pl-3">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-ok" />
              <span className="mono hidden text-[9.5px] uppercase tracking-[0.12em] text-ink-3 lg:block">System online</span>
            </div>
          </div>
        </header>

        {isMobile && (
          <div className="flex items-start gap-2 border-b border-line bg-bg-1 px-4 py-2.5 text-[11.5px] text-ink-3">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>TRACE is designed for desktop. The console remains functional at this width; the graph is best viewed above 900px.</span>
          </div>
        )}

        <main className="mx-auto max-w-[1440px] px-5 py-6 lg:px-7 lg:py-7">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        theme={theme}
        onToggleTheme={() => setTheme((value) => otherTheme(value))}
      />
    </div>
  );
}
