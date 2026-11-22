import type { EntityType } from '@shared/types';
import { ENTITY_META } from '@/lib/format';

const MARKABLE: EntityType[] = ['url', 'upi', 'phone', 'email', 'wallet', 'account'];

const CLASS_MAP: Record<string, string> = {
  url: 'mark mark-url',
  upi: 'mark mark-upi',
  phone: 'mark mark-phone',
  email: 'mark mark-email',
  account: 'mark mark-account',
  wallet: 'mark mark-wallet',
};

export function HighlightedText({
  text,
  entities,
  className,
  showTips = true,
}: {
  text: string;
  entities: { type: EntityType; value: string; start: number; end: number; normalized?: string; note?: string }[];
  className?: string;
  showTips?: boolean;
}) {
  const candidates = entities
    .filter((e) => MARKABLE.includes(e.type) && e.start >= 0 && e.end <= text.length && e.end > e.start)
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const chosen: typeof candidates = [];
  for (const c of candidates) {
    if (chosen.some((x) => c.start < x.end && c.end > x.start)) continue;
    chosen.push(c);
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  chosen.forEach((entity, i) => {
    if (entity.start > cursor) parts.push(text.slice(cursor, entity.start));
    const label = ENTITY_META[entity.type]?.label ?? entity.type;
    parts.push(
      <mark
        key={`${entity.start}-${i}`}
        className={CLASS_MAP[entity.type] ?? 'mark'}
        data-tip={showTips ? `${label} · ${entity.note ?? entity.value}` : undefined}
        aria-label={`${label}: ${entity.value}`}
      >
        {text.slice(entity.start, entity.end)}
      </mark>,
    );
    cursor = entity.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <span className={className}>{parts}</span>;
}
