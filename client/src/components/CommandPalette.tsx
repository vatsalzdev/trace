import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { ArrowRight, FolderOpen, GitBranch, Globe2, LayoutDashboard, PackageSearch, ScanLine, Search, FileText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CaseRecord, EntityRecord } from '@shared/types';
import { api } from '@/lib/api';
import { ENTITY_META, relativeTime, riskClass } from '@/lib/format';
import { ENTITY_ICONS } from './EntityChip';
import { Kbd } from './ui';
import { useEntityDrawer } from './EntityDrawer';

const PAGES = [
  { label: 'Command Center', to: '/app', icon: LayoutDashboard, hint: 'Overview' },
  { label: 'Message Scanner', to: '/app/scan', icon: ScanLine, hint: 'Analyse SMS / WhatsApp' },
  { label: 'URL Intelligence', to: '/app/url', icon: Globe2, hint: 'Domains and links' },
  { label: 'APK Inspector', to: '/app/apk', icon: PackageSearch, hint: 'Unpack Android packages' },
  { label: 'Relationship Graph', to: '/app/graph', icon: GitBranch, hint: 'Correlate indicators' },
  { label: 'Cases', to: '/app/cases', icon: FolderOpen, hint: 'Case files' },
  { label: 'Reports', to: '/app/reports', icon: FileText, hint: 'Generated PDFs' },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const { open: openEntity } = useEntityDrawer();
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [entities, setEntities] = useState<EntityRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    Promise.all([api.cases(), api.entities()])
      .then(([c, e]) => {
        setCases(c.cases);
        setEntities(e.entities);
      })
      .catch(() => {});
  }, [open, loaded]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      contentClassName="fixed left-1/2 top-[12vh] z-[180] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-line-2 glass"
      overlayClassName="fixed inset-0 z-[175] bg-black/55"
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search size={15} className="text-ink-3" />
        <Command.Input
          placeholder="Search cases, indicators, pages…"
          className="h-12 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3"
        />
        <Kbd>esc</Kbd>
      </div>
      <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain p-2">
        <Command.Empty className="px-3 py-10 text-center text-[12.5px] text-ink-3">
          No case, indicator or page matches that query.
        </Command.Empty>

        <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-ink-3">
          {PAGES.map((page) => (
            <Command.Item
              key={page.to}
              value={`${page.label} ${page.hint}`}
              onSelect={() => go(page.to)}
              className="group flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-[12.5px] text-ink-2 aria-selected:bg-white/[0.055] aria-selected:text-ink"
            >
              <page.icon size={14} className="text-ink-3" />
              <span className="flex-1">{page.label}</span>
              <span className="text-[10.5px] text-ink-3">{page.hint}</span>
              <ArrowRight size={12} className="opacity-0 group-aria-selected:opacity-100" />
            </Command.Item>
          ))}
        </Command.Group>

        {cases.length > 0 && (
          <Command.Group heading="Cases" className="mt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-ink-3">
            {cases.map((c) => (
              <Command.Item
                key={c.id}
                value={`${c.id} ${c.title} ${c.raw_input}`}
                onSelect={() => go(`/app/cases/${c.id}`)}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-[12.5px] text-ink-2 aria-selected:bg-white/[0.055] aria-selected:text-ink"
              >
                <span className="mono w-[104px] shrink-0 text-[10px] text-ink-3">{c.id}</span>
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="mono text-[9.5px] text-ink-3">{relativeTime(c.updated_at)}</span>
                <span className={riskClass(c.risk_label)}>{c.risk_label}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {entities.length > 0 && (
          <Command.Group heading="Indicators" className="mt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-ink-3">
            {entities.slice(0, 60).map((e) => {
              const Icon = ENTITY_ICONS[e.type] ?? Globe2;
              return (
                <Command.Item
                  key={e.id}
                  value={`${e.type} ${e.value}`}
                  onSelect={() => {
                    onOpenChange(false);
                    openEntity({ id: e.id, type: e.type, value: e.value });
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-[12px] text-ink-2 aria-selected:bg-white/[0.055] aria-selected:text-ink"
                >
                  <Icon size={13} style={{ color: ENTITY_META[e.type]?.color }} />
                  <span className="mono min-w-0 flex-1 truncate">{e.value}</span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-3">{ENTITY_META[e.type]?.short}</span>
                  {Number(e.case_count) >= 2 && (
                    <span className="mono rounded border border-accent/25 bg-accent/[0.07] px-1 text-[9px] text-accent">
                      {e.case_count} cases
                    </span>
                  )}
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
      </Command.List>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[10px] text-ink-3">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
        <span className="ml-auto mono">TRACE / INDEX</span>
      </div>
    </Command.Dialog>
  );
}
