import { Globe, Link2, Phone, IndianRupee, Mail, Package, Fingerprint, Server, Wallet, Landmark, CreditCard, FolderOpen } from 'lucide-react';
import type { EntityType } from '@shared/types';
import { cn } from '@/lib/cn';
import { ENTITY_META } from '@/lib/format';
import { useEntityDrawer } from './EntityDrawer';

export const ENTITY_ICONS: Record<EntityType | 'case', typeof Globe> = {
  domain: Globe,
  url: Link2,
  phone: Phone,
  upi: IndianRupee,
  email: Mail,
  package: Package,
  apk_hash: Fingerprint,
  ip: Server,
  wallet: Wallet,
  ifsc: Landmark,
  account: CreditCard,
  case: FolderOpen,
};

export function EntityChip({
  type,
  value,
  entityId,
  note,
  suspicious,
  className,
  compact = false,
}: {
  type: EntityType | 'case';
  value: string;
  entityId?: number;
  note?: string;
  suspicious?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const { open } = useEntityDrawer();
  const Icon = ENTITY_ICONS[type] ?? Globe;
  const meta = ENTITY_META[type] ?? ENTITY_META.domain;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        open({ id: entityId, type: type as EntityType, value });
      }}
      className={cn('entity-chip group', suspicious && 'border-warn/30', className)}
      title={note ? `${meta.label} · ${note}` : `${meta.label} — open entity drawer`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: meta.color }} />
      {!compact && <Icon size={10} className="shrink-0 text-ink-3 transition-colors group-hover:text-ink-2" />}
      <span className="truncate">{value}</span>
      {suspicious && <span className="ml-0.5 shrink-0 text-[9px] uppercase tracking-wider text-warn/80">!</span>}
    </button>
  );
}

export function TypeDot({ type, size = 6 }: { type: EntityType | 'case'; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: ENTITY_META[type]?.color ?? 'var(--text-3)' }}
    />
  );
}
